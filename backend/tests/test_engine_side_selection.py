"""Exercise the match setup through the engine's browser WebSocket handlers."""

import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from app.engine.game_engine import GameEngine
from test_engine_heartbeat import JOIN, Socket


def choice(side):
    return {"type": "CHOOSE_SIDE", "payload": {"side": side}}


async def next_payload(socket, kind):
    message = await asyncio.wait_for(socket.sent.get(), 1)
    assert message["type"] == kind
    return message["payload"]


@pytest.fixture
async def match(monkeypatch):
    fake_client = SimpleNamespace(client=SimpleNamespace(close=AsyncMock()))
    monkeypatch.setattr("app.engine.game_engine.OpenAIModelClient", lambda **_: fake_client)
    monkeypatch.setattr("app.engine.game_engine.SessionFactory", lambda: AsyncMock())
    game = GameEngine(uuid4(), (uuid4(), uuid4()), uuid4())
    game.load_players = AsyncMock()
    topic = SimpleNamespace(id=uuid4(), category="Cities", topic="Should transit be free?",
                            pro_position="Transit should be free.", con_position="Transit should charge fares.")
    tasks = []

    def connect(player, socket=None):
        socket = Socket() if socket is None else socket
        tasks.append(asyncio.create_task(game.handle_connection(player, socket)))
        return socket

    def start():
        tasks.append(asyncio.create_task(game.run()))
        return tasks[-1]

    with patch("app.engine.game_engine.ArenaService") as arenas, patch("app.engine.game_engine.TopicRepository") as topics:
        arenas.return_value.get_active = AsyncMock(return_value=SimpleNamespace(api_model_id="demo", display_name="Demo"))
        topics.return_value.get_random_active = AsyncMock(return_value=topic)
        try:
            yield game, connect, start
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)


async def test_both_players_must_acknowledge_and_the_first_valid_pick_locks_both_sides(match):
    game, connect, start = match
    game.MATCH_INTRO_SECONDS = 0.2
    first, second = game.players
    a, b = connect(first), connect(second)
    start()
    await a.messages.put(JOIN)
    await a.messages.put(JOIN)
    await a.messages.put(choice("pro"))
    assert (await next_payload(a, "ERROR"))["code"] == "SIDE_SELECTION_NOT_OPEN"
    await b.messages.put(choice("pro"))
    assert (await next_payload(b, "ERROR"))["code"] == "BAD_MESSAGE"
    await b.messages.put({"type": "JOIN", "payload": {"protocol_version": True}})
    assert (await next_payload(b, "ERROR"))["code"] == "BAD_MESSAGE"
    assert a.sent.empty() and b.sent.empty() and not game.sides

    await b.messages.put(JOIN)
    open_a = await next_payload(a, "SIDE_SELECTION_OPEN")
    open_b = await next_payload(b, "SIDE_SELECTION_OPEN")
    assert open_a["deadline"] == open_b["deadline"]
    assert open_a["topic"]["topic"] == "Should transit be free?"
    assert open_a["topic"]["pro_position"] and open_a["topic"]["con_position"]
    assert all("participants" not in opened and "you" not in opened for opened in (open_a, open_b))
    assert game.prompt_deadline is None

    await a.messages.put({"type": "SUBMIT_PROMPT", "payload": {"prompt": "Too early"}})
    assert (await next_payload(a, "ERROR"))["code"] == "PROMPT_WINDOW_NOT_OPEN"
    await a.messages.put(choice("invalid"))
    assert (await next_payload(a, "ERROR"))["code"] == "BAD_MESSAGE"
    before_pick = datetime.now(UTC)
    # Queue two requests before either reader runs. B's request is ready first.
    b.messages.put_nowait(choice("pro"))
    a.messages.put_nowait(choice("pro"))
    intro_a = await next_payload(a, "MATCH_INTRO")
    intro_b = await next_payload(b, "MATCH_INTRO")
    assert intro_a["deadline"] is intro_b["deadline"] is None
    assert (intro_a["you"], intro_b["you"]) == ("con", "pro")
    assert {entry["user_id"] for entry in intro_a["participants"]} == {str(first), str(second)}
    await a.messages.put({"type": "SUBMIT_PROMPT", "payload": {"prompt": "During the reveal"}})
    assert (await next_payload(a, "ERROR"))["code"] == "PROMPT_WINDOW_NOT_OPEN"
    state_a = await next_payload(a, "MATCH_STATE")
    state_b = await next_payload(b, "MATCH_STATE")
    assert (state_a["you"], state_b["you"]) == ("con", "pro")
    assert state_a["deadline"] == state_b["deadline"]
    assert (datetime.fromisoformat(state_a["deadline"]) - before_pick).total_seconds() >= game.PROMPT_WINDOW_SECONDS + game.MATCH_INTRO_SECONDS
    assert not game.prompts

    await b.messages.put(choice("con"))
    await b.messages.put(choice(None))
    assert (await next_payload(b, "ERROR"))["code"] == "BAD_MESSAGE"
    assert game.sides == {first: "con", second: "pro"}


async def test_replacement_requires_its_own_join_and_replays_the_current_setup_window(match):
    game, connect, start = match
    game.MATCH_INTRO_SECONDS = 0.2
    a_id, b_id = game.players
    original, b = connect(a_id), connect(b_id)
    start()
    await original.messages.put(JOIN)
    await original.messages.put(choice("con"))
    await next_payload(original, "ERROR")
    a = connect(a_id)
    await asyncio.sleep(0)
    assert original.closes == [4409]
    await b.messages.put(JOIN)
    await b.messages.put(choice("con"))
    assert (await next_payload(b, "ERROR"))["code"] == "SIDE_SELECTION_NOT_OPEN"
    await a.messages.put(JOIN)
    original_window = await next_payload(a, "SIDE_SELECTION_OPEN")
    await next_payload(b, "SIDE_SELECTION_OPEN")

    replacement = connect(a_id)
    await asyncio.sleep(0)
    assert a.closes == [4409]
    await a.messages.put(choice("con"))
    await replacement.messages.put(JOIN)
    assert await next_payload(replacement, "SIDE_SELECTION_OPEN") == original_window
    await b.messages.put(choice("con"))
    intro = await next_payload(replacement, "MATCH_INTRO")
    await next_payload(b, "MATCH_INTRO")
    revealing = connect(a_id)
    await revealing.messages.put(JOIN)
    assert await next_payload(revealing, "MATCH_INTRO") == intro
    state = await next_payload(revealing, "MATCH_STATE")
    assert state["you"] == "pro"
    assert (await next_payload(b, "MATCH_STATE"))["you"] == "con"

    prompting = connect(a_id)
    await prompting.messages.put(JOIN)
    assert await next_payload(prompting, "MATCH_STATE") == state


async def test_expiry_assigns_sides_without_a_pick_and_ignores_a_late_choice(match, monkeypatch):
    game, connect, start = match
    a_id, b_id = game.players
    monkeypatch.setattr("app.engine.game_engine.random.choice", lambda players: players[1])
    game.SIDE_SELECTION_SECONDS = 0.02
    a, b = connect(a_id), connect(b_id)
    start()
    await a.messages.put(JOIN)
    await b.messages.put(JOIN)
    await next_payload(a, "SIDE_SELECTION_OPEN")
    await next_payload(b, "SIDE_SELECTION_OPEN")
    await next_payload(a, "MATCH_INTRO")
    await next_payload(b, "MATCH_INTRO")
    assert (await next_payload(a, "MATCH_STATE"))["you"] == "con"
    assert (await next_payload(b, "MATCH_STATE"))["you"] == "pro"
    await a.messages.put(choice("pro"))
    await a.messages.put(choice(None))
    assert (await next_payload(a, "ERROR"))["code"] == "BAD_MESSAGE"
    assert game.sides == {a_id: "con", b_id: "pro"}


async def test_stalled_selection_send_does_not_extend_the_deadline(match):
    class StalledSocket(Socket):
        async def send_json(self, message):
            if message["type"] == "SIDE_SELECTION_OPEN":
                await asyncio.Event().wait()
            await super().send_json(message)

    game, connect, start = match
    game.SIDE_SELECTION_SECONDS = 0.02
    a, b = connect(game.players[0]), connect(game.players[1], StalledSocket())
    start()
    await a.messages.put(JOIN)
    await b.messages.put(JOIN)
    await next_payload(a, "SIDE_SELECTION_OPEN")
    await next_payload(a, "MATCH_INTRO")
    await next_payload(b, "MATCH_INTRO")
    state_a = await next_payload(a, "MATCH_STATE")
    state_b = await next_payload(b, "MATCH_STATE")
    assert {state_a["you"], state_b["you"]} == {"pro", "con"}


async def test_resign_during_selection_records_both_players_and_skips_prompts(match):
    game, connect, start = match
    a, b = (connect(player) for player in game.players)
    engine = start()
    await a.messages.put(JOIN)
    await b.messages.put(JOIN)
    await next_payload(a, "SIDE_SELECTION_OPEN")
    await next_payload(b, "SIDE_SELECTION_OPEN")
    await a.messages.put({"type": "RESIGN", "payload": {}})
    result = await next_payload(a, "MATCH_RESULT")
    assert result == await next_payload(b, "MATCH_RESULT")
    assert result["end_reason"] == "resigned"
    assert result["winner"] == game.sides[game.players[1]]
    assert {player["side"] for player in result["participants"]} == {"pro", "con"}
    assert game.prompt_deadline is None
    await asyncio.wait_for(engine, 1)
