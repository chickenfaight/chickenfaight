import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from app.engine.game_engine import GameEngine


class EngineJudgingTests(unittest.IsolatedAsyncioTestCase):
    async def check_judging(self, disconnect=False):
        players = (uuid4(), uuid4())
        with patch("app.engine.game_engine.OpenAIModelClient"):
            engine = GameEngine(uuid4(), players, "byom")
        engine.both_connected.set()
        generated = set()
        events = []

        async def generate(player):
            generated.add(player)

        def send(player):
            async def record(message):
                self.assertEqual(generated, set(players))
                events.append((player, message))
                if disconnect and player == players[0]:
                    del engine.connections[player]
                    raise RuntimeError("Socket closed")
            return record

        for player in players:
            engine.connections[player] = SimpleNamespace(send_json=send(player))

        async def judge(*args):
            self.assertEqual(events, [
                (player, {"type": "JUDGING", "payload": {}})
                for player in players
            ])
            return SimpleNamespace()

        engine.judge_clients = SimpleNamespace(
            judge=AsyncMock(side_effect=judge),
            client=SimpleNamespace(close=AsyncMock()),
        )
        with (
            patch("app.engine.game_engine.SessionFactory", return_value=AsyncMock()),
            patch("app.engine.game_engine.TopicRepository") as repository,
            patch.object(engine, "broadcast_initial_game_state", new=AsyncMock()),
            patch.object(engine, "generate_arguments", side_effect=generate),
            patch.object(engine, "broadcast_verdict", new=AsyncMock()) as result,
        ):
            repository.return_value.get_random_active = AsyncMock(return_value=object())
            await engine.run()

        engine.judge_clients.judge.assert_awaited_once()
        result.assert_awaited_once()

    async def test_notifies_both_players_before_judge_call(self):
        await self.check_judging()

    async def test_disconnect_does_not_prevent_notification_or_judging(self):
        await self.check_judging(disconnect=True)
