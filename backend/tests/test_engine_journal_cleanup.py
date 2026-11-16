"""A failed durable write must withhold the verdict without retaining match resources."""
import asyncio
import errno
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from app.engine.game_engine import GameEngine
from app.services import result_outbox


@pytest.mark.records_matches
@pytest.mark.parametrize("byom", [False, True])
async def test_journal_failure_withholds_result_and_releases_engine_resources(byom):
    players = (uuid4(), uuid4())
    devices = {player: uuid4() for player in players} if byom else {}
    bilc = SimpleNamespace(assign=AsyncMock(), end_match=AsyncMock(), hello=lambda _: None)
    with patch("app.engine.game_engine.OpenAIModelClient"):
        game = GameEngine(uuid4(), players, uuid4(), devices=devices, bilc=bilc)
    game.judge_clients = SimpleNamespace(client=SimpleNamespace(close=AsyncMock()))
    game.cloud_client = SimpleNamespace(client=SimpleNamespace(close=AsyncMock()))
    sockets = [SimpleNamespace(send_json=AsyncMock()) for _ in players]
    game.connections = dict(zip(players, sockets))
    topic = SimpleNamespace(id=uuid4(), topic="Transit", category="Cities",
                            pro_position="Free", con_position="Fares")

    async def finish():
        await game.broadcast_result({"status": "voided", "winner": None,
                                     "end_reason": "model_failure", "reason": "Unavailable"})

    @asynccontextmanager
    async def no_database():
        yield None

    with (
        patch("app.engine.game_engine.SessionFactory", no_database),
        patch("app.engine.game_engine.ArenaService") as arenas,
        patch("app.engine.game_engine.TopicRepository") as topics,
        patch("app.engine.game_engine.record_match", new=AsyncMock()) as record,
        patch.object(game, "play", side_effect=finish),
        patch.object(result_outbox.pending_results, "_save",
                     side_effect=OSError(errno.ENOSPC, "Result journal disk is full")),
    ):
        arenas.return_value.get_active = AsyncMock(return_value=SimpleNamespace(
            api_model_id="test", display_name="Test"))
        topics.return_value.get_random_active = AsyncMock(return_value=topic)
        with pytest.raises(OSError, match="disk is full"):
            await asyncio.wait_for(game.run(), 1)

    record.assert_not_awaited()
    assert not game.reported
    for socket in sockets:
        assert not any(call.args[0]["type"] == "MATCH_RESULT"
                       for call in socket.send_json.await_args_list)
    assert game.finished.is_set()
    game.judge_clients.client.close.assert_awaited_once()
    game.cloud_client.client.close.assert_awaited_once()
    assert bilc.end_match.await_count == len(devices)
    for device in devices.values():
        bilc.end_match.assert_any_await(device, game.match_id, "voided")
