"""Real SDK over loopback HTTP, never a provider or an SDK mock."""
import asyncio
import json
import threading
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

import pytest
from openai import APIStatusError

from app.config import settings
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


def chunk(content):
    return b"data: " + json.dumps({"id": "test", "choices": [{"index": 0, "delta": content}]}).encode() + b"\n\n"


async def test_sdk_reads_fragmented_sse_and_drops_reasoning(inference_server):
    inference_server["body"] = chunk({"content": "Opening "}) + chunk({"reasoning": "private"}) + chunk({"content": "argument."}) + b"data: [DONE]\n\n"
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


@pytest.mark.xfail(strict=True, reason="Existing adapter accepts EOF after partial text without a finish marker; flagged for follow-up, no further debugging in this change")
async def test_incomplete_sse_must_not_be_accepted_as_a_completed_turn(inference_server):
    inference_server["body"] = chunk({"content": "partial argument"})
    with patch("app.inference.model_client.settings", replace(settings, inference_base_url=inference_server["url"])):
        client = OpenAIModelClient("http-test")
    try:
        with pytest.raises(ValueError, match="incomplete"):
            _ = [delta async for delta in client.stream([{"role": "user", "content": "rules"}])]
    finally:
        await client.client.close()
