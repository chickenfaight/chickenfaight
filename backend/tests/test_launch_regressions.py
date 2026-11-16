"""Lifecycle regressions: fake clocks/sockets/models, no real DB or provider."""
import asyncio
from json import JSONDecodeError
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import WebSocketDisconnect

from app.engine.game_engine import ConnectionActivity, GameEngine
from app.services.matchmaking import Matchmaker
from app.services.rewards import _advance_streak, effective_streak
from test_engine_heartbeat import Socket


def engine():
    with patch("app.engine.game_engine.OpenAIModelClient"):
        return GameEngine(uuid4(), (uuid4(), uuid4()), uuid4())


@pytest.mark.parametrize("streak", [6, 13])
def test_bonus_day_followed_by_same_day_finish_keeps_streak(streak):
    now = datetime(2026, 11, 15, 12, tzinfo=UTC)
    user = SimpleNamespace(streak=streak, last_played_at=now - timedelta(days=1))
    assert _advance_streak(user, now) == 25
    assert user.last_played_at == now
    assert _advance_streak(user, now + timedelta(minutes=1)) == 0
    assert user.streak == streak + 1


@pytest.mark.parametrize("gap,expected", [(timedelta(hours=48), 5), (timedelta(hours=48, microseconds=1), 1)])
def test_streak_grace_boundary(gap, expected):
    last = datetime(2026, 11, 13, 12, tzinfo=UTC)
    user = SimpleNamespace(streak=4, last_played_at=last)
    assert effective_streak(user, last + gap) == (4 if expected == 5 else 0)
    _advance_streak(user, last + gap)
    assert user.streak == expected


@pytest.mark.parametrize("daily_first", [True, False])
async def test_quick_queue_fills_regular_queue_only(daily_first):
    mm = Matchmaker()
    model, daily, regular, quick = (uuid4() for _ in range(4))
    registrations = [(daily, date(2026, 11, 15)), (regular, None)]
    for user, day in registrations if daily_first else reversed(registrations):
        mm.register(user, model, 1000, day)
    mm.register(quick, None, 1000)
    with patch("app.services.matchmaking.GameEngine") as game, patch.object(mm, "start"):
        await mm.match_available_players()
    assert game.call_count == 1
    assert set(game.call_args.args[1]) == {regular, quick}
    assert game.call_args.args[3] is None
    assert mm.get_status(daily) == {"status": "queued"}


@pytest.mark.parametrize("joined", [0, 1])
async def test_join_deadline_decides_no_show_without_inference(joined):
    game = engine()
    game.JOIN_WINDOW_SECONDS = 0.01
    for player in game.players[:joined]:
        game.connections[player] = SimpleNamespace(send_json=AsyncMock())
    game.generate_arguments = AsyncMock()
    await asyncio.wait_for(game.play(), 1)
    assert game.result["end_reason"] == "no_show"
    assert game.result["status"] == ("forfeited" if joined else "voided")
    assert game.result["winner"] == (game.sides[game.players[0]] if joined else None)
    game.generate_arguments.assert_not_awaited()


async def test_departure_before_other_player_arrives_does_not_count_as_joined():
    game = engine()
    game.JOIN_WINDOW_SECONDS = 0.02
    socket = Socket()
    task = asyncio.create_task(game.handle_connection(game.players[0], socket))
    await socket.messages.put(WebSocketDisconnect())
    await asyncio.wait_for(task, 1)
    await asyncio.wait_for(game.play(), 1)
    assert game.result["status"] == "voided"
    assert not game.connections


async def test_replaced_socket_cannot_submit_or_resign():
    game = engine()
    player = game.players[0]
    old, new = Socket(), Socket()
    old_task = asyncio.create_task(game.handle_connection(player, old))
    await asyncio.sleep(0)
    new_task = asyncio.create_task(game.handle_connection(player, new))
    try:
        await asyncio.sleep(0)
        assert old.closes == [4409]
        await old.messages.put({"type": "RESIGN", "payload": {}})
        await asyncio.wait_for(old_task, 1)
        assert game.result is None
        assert game.connections[player] is new
        await new.messages.put({"type": "SUBMIT_PROMPT", "payload": {"prompt": "accepted"}})
        await asyncio.wait_for(game.prompt_received[player].wait(), 1)
        assert game.prompts[player] == "accepted"
    finally:
        game.finished.set()
        await asyncio.wait_for(asyncio.gather(old_task, new_task), 1)


@pytest.mark.parametrize("message,code", [
    ([], "BAD_MESSAGE"), ({"type": 1}, "BAD_MESSAGE"),
    ({"type": "UNKNOWN", "payload": {}}, "UNKNOWN_TYPE"),
    ({"type": "SUBMIT_PROMPT", "payload": {}}, "PROMPT_TOO_LONG"),
    ({"type": "SUBMIT_PROMPT", "payload": {"prompt": 1}}, "PROMPT_TOO_LONG"),
    ({"type": "SUBMIT_PROMPT", "payload": {"prompt": "x" * 2001}}, "PROMPT_TOO_LONG"),
    ({"type": "SUBMIT_PROMPT", "payload": {"prompt": "  "}}, "BAD_MESSAGE"),
])
async def test_rejected_message_leaves_prompt_editable(message, code):
    game, socket = engine(), Socket()
    player = game.players[0]
    task = asyncio.create_task(game.receive_messages(player, socket, ConnectionActivity()))
    try:
        await socket.messages.put(message)
        error = await asyncio.wait_for(socket.sent.get(), 1)
        assert error["payload"]["code"] == code
        assert not game.prompts and game.result is None
        await socket.messages.put({"type": "SUBMIT_PROMPT", "payload": {"prompt": "x" * 2000}})
        await asyncio.wait_for(game.prompt_received[player].wait(), 1)
        await socket.messages.put({"type": "SUBMIT_PROMPT", "payload": {"prompt": "replacement"}})
        error = await asyncio.wait_for(socket.sent.get(), 1)
        assert error["payload"]["code"] == "PROMPT_ALREADY_SUBMITTED"
        assert game.prompts[player] == "x" * 2000
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


async def test_shutdown_awaits_workers_and_clears_queues():
    mm = Matchmaker()
    game = engine()
    entered, cleaned = asyncio.Event(), asyncio.Event()

    async def run():
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            await asyncio.sleep(0)
            cleaned.set()

    game.run = run
    mm.assignments.update({p: game.match_id for p in game.players})
    mm.start(game)
    mm.register(uuid4(), None, 1000)
    await entered.wait()
    await asyncio.wait_for(mm.close(), 1)
    assert cleaned.is_set()
    assert not any((mm.tasks, mm.engines, mm.assignments, mm.queued_users, mm.randomqueue))


async def test_old_engine_cleanup_preserves_new_assignment():
    mm, game = Matchmaker(), engine()
    newer = uuid4()
    mm.assignments[game.players[0]] = newer
    game.run = AsyncMock()
    await mm.run_match(game)
    assert mm.assignments[game.players[0]] == newer


@pytest.mark.parametrize("malformed", [JSONDecodeError("bad", "{", 0), KeyError("text"), UnicodeDecodeError("utf8", b"\xff", 0, 1, "bad")])
async def test_bad_json_or_binary_frame_does_not_kill_receiver(malformed):
    game, socket = engine(), Socket()
    task = asyncio.create_task(game.receive_messages(game.players[0], socket, ConnectionActivity()))
    try:
        await socket.messages.put(malformed)
        error = await asyncio.wait_for(socket.sent.get(), 1)
        assert error["payload"]["code"] == "BAD_MESSAGE"
        assert not task.done() and not game.prompts
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


@pytest.mark.parametrize("phase", ["joining", "generating", "judging"])
async def test_cancelling_real_engine_voids_and_awaits_inflight_work(phase):
    game = engine()
    entered, cancelled = asyncio.Event(), asyncio.Event()
    topic = SimpleNamespace(id=uuid4(), category="T", topic="T", pro_position="P", con_position="C")

    class Client:
        def __init__(self, model=None):
            self.client = SimpleNamespace(close=AsyncMock())

        async def stream(self, messages, max_tokens):
            if phase == "generating":
                entered.set()
                try:
                    await asyncio.Event().wait()
                finally:
                    cancelled.set()
            yield "argument"

    async def judge(*args):
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    game.judge_clients = SimpleNamespace(judge=judge, client=SimpleNamespace(close=AsyncMock()))
    if phase != "joining":
        game.both_connected.set()
        for player in game.players:
            game.prompts[player] = "private"
            game.prompt_received[player].set()
    with patch("app.engine.game_engine.SessionFactory", return_value=AsyncMock()), patch(
        "app.engine.game_engine.ArenaService"
    ) as arenas, patch("app.engine.game_engine.TopicRepository") as topics, patch(
        "app.engine.game_engine.OpenAIModelClient", Client
    ):
        arenas.return_value.get_active = AsyncMock(return_value=SimpleNamespace(api_model_id="test", display_name="Test"))
        topics.return_value.get_random_active = AsyncMock(return_value=topic)
        task = asyncio.create_task(game.run())
        if phase == "joining":
            await asyncio.sleep(0)
            await asyncio.sleep(0)
        else:
            await asyncio.wait_for(entered.wait(), 1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, 1)
    assert game.result["status"] == "voided"
    assert game.finished.is_set()
    if phase != "joining":
        assert cancelled.is_set()
    game.judge_clients.client.close.assert_awaited_once()


@pytest.mark.records_matches
async def test_failed_recording_can_retry_and_concurrent_calls_commit_once():
    game = engine()
    game.result = {"status": "voided", "winner": None, "end_reason": "model_failure"}
    with patch("app.engine.game_engine.SessionFactory", return_value=AsyncMock()), patch(
        "app.engine.game_engine.record_match", new=AsyncMock(side_effect=[RuntimeError("unavailable"), None])
    ) as record:
        await game.report_game()
        assert not game.reported
        first_report = record.await_args.args[1]
        await asyncio.gather(game.report_game(), game.report_game())
        assert game.reported and record.await_count == 2
        assert record.await_args.args[1] is first_report
