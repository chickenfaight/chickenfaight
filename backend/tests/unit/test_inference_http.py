"""Real SDK over loopback HTTP, never a provider or an SDK mock."""
import asyncio
import json
import threading
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from openai import APIStatusError

from app.config import settings
from app.engine.game_engine import GameEngine
from app.inference.model_client import OpenAIModelClient


@pytest.fixture
def inference_server():
    state = {"status": 200, "body": b"", "requests": [], "hang": False}
    release = threading.Event()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            state["requests"].append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            self.send_response(state["status"])
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            if state["hang"]:
                release.wait(3)
                return
            try:
                # Split in the middle of JSON to exercise transport fragmentation.
                for offset in range(0, len(state["body"]), 7):
                    self.wfile.write(state["body"][offset:offset+7])
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    state["url"] = f"http://127.0.0.1:{server.server_port}/v1"
    yield state
    release.set()
    server.shutdown()
    server.server_close()
    thread.join()


def chunk(content, finish_reason=None):
    return b"data: " + json.dumps({"id": "test", "choices": [{"index": 0, "delta": content, "finish_reason": finish_reason}]}).encode() + b"\n\n"


async def test_sdk_reads_fragmented_sse_and_drops_reasoning(inference_server):
    inference_server["body"] = chunk({"content": "Opening "}) + chunk({"reasoning": "private"}) + chunk({"content": "argument."}, "stop") + b"data: [DONE]\n\n"
    with patch("app.inference.model_client.settings", replace(settings, inference_base_url=inference_server["url"])):
        client = OpenAIModelClient("http-test")
    try:
        assert [d async for d in client.stream([{"role": "user", "content": "rules"}])] == ["Opening ", "argument."]
        assert inference_server["requests"][0]["messages"] == [{"role": "user", "content": "rules"}]
    finally:
        await client.client.close()


@pytest.mark.parametrize("status", [400, 401, 429, 500])
async def test_sdk_http_errors_propagate_to_engine(inference_server, status):
    inference_server["status"] = status
    inference_server["body"] = b'{"error":{"message":"unavailable"}}'
    with patch("app.inference.model_client.settings", replace(settings, inference_base_url=inference_server["url"])):
        client = OpenAIModelClient("http-test")
    client.client.max_retries = 0
    try:
        with pytest.raises(APIStatusError):
            await anext(client.stream([{"role": "user", "content": "rules"}]))
    finally:
        await client.client.close()


async def test_cancellation_of_http_read_is_bounded(inference_server):
    inference_server["hang"] = True
    with patch("app.inference.model_client.settings", replace(settings, inference_base_url=inference_server["url"])):
        client = OpenAIModelClient("http-test")
    stream = client.stream([{"role": "user", "content": "rules"}])
    try:
        with pytest.raises(TimeoutError):
            async with asyncio.timeout(0.1):
                await anext(stream)
    finally:
        await stream.aclose()
        await client.client.close()


@pytest.mark.parametrize("ending", [b"", b"data: [DONE]\n\n"])
async def test_incomplete_sse_must_not_be_accepted_as_a_completed_turn(inference_server, ending):
    inference_server["body"] = chunk({"content": "partial argument"}) + ending
    with patch("app.inference.model_client.settings", replace(settings, inference_base_url=inference_server["url"])):
        client = OpenAIModelClient("http-test")
    try:
        with pytest.raises(ValueError, match="incomplete"):
            _ = [delta async for delta in client.stream([{"role": "user", "content": "rules"}])]
    finally:
        await client.client.close()


@pytest.mark.parametrize("finish_reason", ["stop", "length"])
@pytest.mark.parametrize("ending", [b"", b"data: [DONE]\n\n"])
async def test_terminal_choice_completes_turn_and_keeps_its_text(inference_server, finish_reason, ending):
    inference_server["body"] = chunk({"content": "Opening "}) + chunk({"content": "argument."}, finish_reason) + ending
    with patch("app.inference.model_client.settings", replace(settings, inference_base_url=inference_server["url"])):
        client = OpenAIModelClient("http-test")
    try:
        assert [d async for d in client.stream([{"role": "user", "content": "rules"}])] == ["Opening ", "argument."]
    finally:
        await client.client.close()


@pytest.mark.parametrize("finish_reason", ["content_filter", "tool_calls", "function_call", "unknown"])
async def test_non_text_completion_is_a_failed_turn(inference_server, finish_reason):
    inference_server["body"] = chunk({"content": "partial argument"}) + chunk({}, finish_reason)
    with patch("app.inference.model_client.settings", replace(settings, inference_base_url=inference_server["url"])):
        client = OpenAIModelClient("http-test")
    try:
        with pytest.raises(ValueError, match="completed text turn"):
            _ = [d async for d in client.stream([{"role": "user", "content": "rules"}])]
    finally:
        await client.client.close()


async def test_incomplete_http_stream_voids_match_without_retry_or_judging(inference_server):
    inference_server["body"] = chunk({"content": "partial argument"})
    with patch("app.inference.model_client.settings", replace(settings, inference_base_url=inference_server["url"])):
        client = OpenAIModelClient("http-test")
    with patch("app.engine.game_engine.OpenAIModelClient"):
        game = GameEngine(uuid4(), (uuid4(), uuid4()), uuid4())
    game.cloud_client = client
    game.api_model_id = "http-test"
    game.topic = SimpleNamespace(topic="T", pro_position="P", con_position="C")
    game.both_connected.set()
    game.broadcast_initial_game_state = AsyncMock()
    game.broadcast_result = AsyncMock()
    game.judge_clients = SimpleNamespace(judge=AsyncMock())
    for player in game.players:
        game.prompts[player] = "private"
        game.prompt_received[player].set()
    try:
        await game.play()
        result = game.broadcast_result.await_args.args[0]
        assert (result["status"], result["end_reason"], result["winner"]) == ("voided", "model_failure", None)
        game.judge_clients.judge.assert_not_awaited()
        # Each side has distinct wrapped messages. A retry would duplicate one.
        messages = [json.dumps(request["messages"]) for request in inference_server["requests"]]
        assert messages and len(messages) == len(set(messages))
    finally:
        await client.client.close()
