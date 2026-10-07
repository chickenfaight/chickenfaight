import asyncio
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from app.engine.game_engine import GameEngine, PromptDeadlineExpired, ConnectionActivity
from app.schemas.schemas import Verdict
from test_engine_heartbeat import Socket
from test_engine_prompt import RecordingClient


class ArenaEngineTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.players = (uuid4(), uuid4())
        with patch("app.engine.game_engine.OpenAIModelClient"):
            self.engine = GameEngine(uuid4(), self.players, "test-model")
        self.engine.sides = dict(zip(self.players, ("pro", "con")))
        self.engine.topic = SimpleNamespace(
            category="Cities", topic="Should transit be free?",
            pro_position="Transit should be free.", con_position="Transit should not be free.",
        )
        self.engine.prompt_deadline = datetime.now(timezone.utc) + timedelta(seconds=120)

    async def test_initial_state_supplies_same_deadline_and_complete_positions(self):
        for player in self.players:
            self.engine.connections[player] = SimpleNamespace(send_json=AsyncMock())
        await self.engine.broadcast_initial_game_state()
        for player, socket in self.engine.connections.items():
            state = socket.send_json.call_args.args[0]["payload"]
            self.assertEqual(state["deadline"], self.engine.prompt_deadline.isoformat())
            self.assertEqual(state["you"], self.engine.sides[player])
            self.assertEqual(state["topic"]["pro_position"], "Transit should be free.")

    async def test_turn_end_follows_deltas_only_for_its_author(self):
        player, opponent = self.players
        own, other = AsyncMock(), AsyncMock()
        self.engine.connections = {player: SimpleNamespace(send_json=own), opponent: SimpleNamespace(send_json=other)}
        self.engine.model_clients[player] = RecordingClient()
        self.engine.prompts[player] = "A private strategy."
        self.engine.prompt_received[player].set()
        await self.engine.generate_arguments(player)
        self.assertEqual([call.args[0]["type"] for call in own.call_args_list], ["TURN_DELTA", "TURN_DELTA", "TURN_END"])
        other.assert_not_awaited()

    async def test_result_shares_arguments_but_never_prompts(self):
        self.engine.arguments = {"pro": "Pro argument.", "con": "Con argument."}
        self.engine.prompts = {self.players[0]: "PRIVATE PRO", self.players[1]: "PRIVATE CON"}
        self.engine.verdict = Verdict(winner="con", reason="More persuasive.")
        for player in self.players:
            self.engine.connections[player] = SimpleNamespace(send_json=AsyncMock())
        await self.engine.broadcast_verdict()
        for socket in self.engine.connections.values():
            result = socket.send_json.call_args.args[0]["payload"]
            self.assertEqual(result["arguments"], self.engine.arguments)
            self.assertEqual(result["winner"], "con")
            self.assertNotIn("PRIVATE", str(result))

    async def test_expired_prompt_does_not_start_inference(self):
        self.engine.prompt_deadline = datetime.now(timezone.utc) - timedelta(seconds=1)
        with self.assertRaises(PromptDeadlineExpired):
            await self.engine.generate_arguments(self.players[0])

    async def test_late_submission_is_rejected_by_server(self):
        self.engine.prompt_deadline = datetime.now(timezone.utc) - timedelta(seconds=1)
        socket = Socket()
        reader = asyncio.create_task(self.engine.receive_messages(self.players[0], socket, ConnectionActivity()))
        try:
            await socket.messages.put({"type": "SUBMIT_PROMPT", "payload": {"prompt": "Too late"}})
            message = await asyncio.wait_for(socket.sent.get(), 1)
            self.assertEqual(message["payload"]["code"], "PROMPT_DEADLINE_PASSED")
            self.assertFalse(self.engine.prompts)
        finally:
            reader.cancel()
            await asyncio.gather(reader, return_exceptions=True)

    async def test_deadline_outcomes_skip_judge(self):
        for submits in (False, True):
            with self.subTest(submits=submits):
                self.setUp()
                self.engine.PROMPT_WINDOW_SECONDS = 0.01
                self.engine.both_connected.set()
                self.engine.judge_clients = SimpleNamespace(judge=AsyncMock(), client=SimpleNamespace(close=AsyncMock()))
                if submits:
                    player = self.players[0]
                    self.engine.prompts[player] = "Accepted strategy"
                    self.engine.prompt_received[player].set()
                    self.engine.model_clients[player] = RecordingClient()
                self.engine.model = "byom"
                with (
                    patch("app.engine.game_engine.SessionFactory", return_value=AsyncMock()),
                    patch("app.engine.game_engine.TopicRepository") as repo,
                    patch.object(self.engine, "broadcast_result", new=AsyncMock()) as result,
                ):
                    repo.return_value.get_random_active = AsyncMock(return_value=self.engine.topic)
                    await self.engine.run()
                payload = result.call_args.args[0]
                self.assertEqual(payload["winner"], "pro" if submits else None)
                self.assertEqual(payload["status"], "forfeited" if submits else "voided")
                self.engine.judge_clients.judge.assert_not_awaited()
