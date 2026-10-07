import asyncio
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from app.engine.game_engine import GameEngine, ModelFailure, PromptDeadlineExpired, ConnectionActivity
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


class ScriptedClient:
    """Each `stream` call plays the next script: a list of deltas, optionally ending in an exception."""

    def __init__(self, *scripts):
        self.scripts = list(scripts)
        self.calls = 0

    async def stream(self, messages, max_tokens=400):
        script = self.scripts[self.calls]
        self.calls += 1
        for step in script:
            if isinstance(step, BaseException):
                raise step
            if step == "hang":
                await asyncio.sleep(10)
            yield step


class ModelFailureTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.players = (uuid4(), uuid4())
        with patch("app.engine.game_engine.OpenAIModelClient"):
            self.engine = GameEngine(uuid4(), self.players, "test-model")
        self.engine.sides = dict(zip(self.players, ("pro", "con")))
        self.engine.topic = SimpleNamespace(
            category="Cities", topic="Should transit be free?",
            pro_position="Transit should be free.", con_position="Transit should not be free.",
        )
        self.player = self.players[0]
        self.socket = SimpleNamespace(send_json=AsyncMock())
        self.engine.connections[self.player] = self.socket
        self.engine.prompts[self.player] = "A private strategy."
        self.engine.prompt_received[self.player].set()

    def sent_types(self):
        return [call.args[0]["type"] for call in self.socket.send_json.call_args_list]

    async def test_failed_turn_is_retried_once(self):
        client = ScriptedClient([TimeoutError()], ["Retried ", "argument."])
        self.engine.model_clients[self.player] = client
        await self.engine.generate_arguments(self.player)
        self.assertEqual(client.calls, 2)
        self.assertEqual(self.engine.arguments["pro"], "Retried argument.")
        self.assertEqual(self.sent_types(), ["TURN_DELTA", "TURN_DELTA", "TURN_END"])

    async def test_turn_failing_twice_is_a_model_failure(self):
        self.engine.model_clients[self.player] = ScriptedClient([ValueError()], [ValueError()])
        with self.assertRaises(ModelFailure):
            await self.engine.generate_arguments(self.player)
        self.assertNotIn("TURN_END", self.sent_types())

    async def test_turn_failing_after_streaming_is_not_retried(self):
        client = ScriptedClient(["Partial ", TimeoutError()], ["never used"])
        self.engine.model_clients[self.player] = client
        with self.assertRaises(ModelFailure):
            await self.engine.generate_arguments(self.player)
        self.assertEqual(client.calls, 1)

    async def test_first_token_timeout(self):
        self.engine.FIRST_TOKEN_TIMEOUT = 0.01
        self.engine.model_clients[self.player] = ScriptedClient(["hang"], ["hang"])
        with self.assertRaises(ModelFailure):
            await self.engine.generate_arguments(self.player)

    async def test_total_turn_timeout(self):
        self.engine.TURN_TIMEOUT = 0.05
        self.engine.model_clients[self.player] = ScriptedClient(["Started", "hang"])
        with self.assertRaises(ModelFailure):
            await self.engine.generate_arguments(self.player)

    async def run_engine(self, judge):
        self.engine.both_connected.set()
        self.engine.model = "byom"  # skip creating a cloud client; generate_arguments is patched anyway
        self.engine.judge_clients = SimpleNamespace(judge=judge, client=SimpleNamespace(close=AsyncMock()))
        with (
            patch("app.engine.game_engine.SessionFactory", return_value=AsyncMock()),
            patch("app.engine.game_engine.TopicRepository") as repo,
            patch.object(self.engine, "broadcast_initial_game_state", new=AsyncMock()),
            patch.object(self.engine, "broadcast_result", new=AsyncMock()) as result,
        ):
            repo.return_value.get_random_active = AsyncMock(return_value=self.engine.topic)
            await self.engine.run()
        return result

    async def test_model_failure_voids_match_without_judging(self):
        judge = AsyncMock()

        async def fail(player):
            raise ModelFailure("pro")

        with patch.object(self.engine, "generate_arguments", side_effect=fail):
            result = await self.run_engine(judge)
        payload = result.call_args.args[0]
        self.assertEqual((payload["winner"], payload["status"], payload["end_reason"]), (None, "voided", "model_failure"))
        judge.assert_not_awaited()

    async def test_judge_is_retried_once(self):
        verdict = Verdict(winner="pro", reason="Clearer.")
        judge = AsyncMock(side_effect=[ValueError("unparseable"), verdict])
        with patch.object(self.engine, "generate_arguments", new=AsyncMock()):
            result = await self.run_engine(judge)
        self.assertEqual(judge.await_count, 2)
        payload = result.call_args.args[0]
        self.assertEqual((payload["winner"], payload["end_reason"]), ("pro", "judged"))

    async def test_judge_failing_twice_voids_match(self):
        judge = AsyncMock(side_effect=[TimeoutError(), ValueError()])
        with patch.object(self.engine, "generate_arguments", new=AsyncMock()):
            result = await self.run_engine(judge)
        payload = result.call_args.args[0]
        self.assertEqual((payload["winner"], payload["status"], payload["end_reason"]), (None, "voided", "judge_failure"))

    async def test_empty_turn_is_retried(self):
        client = ScriptedClient([], ["Real ", "argument."])
        self.engine.model_clients[self.player] = client
        await self.engine.generate_arguments(self.player)
        self.assertEqual(client.calls, 2)
        self.assertEqual(self.engine.arguments["pro"], "Real argument.")

    async def test_whitespace_turn_is_retried_without_keeping_it(self):
        client = ScriptedClient(["  \n"], ["Real argument."])
        self.engine.model_clients[self.player] = client
        await self.engine.generate_arguments(self.player)
        self.assertEqual(self.engine.arguments["pro"], "Real argument.")

    async def test_empty_twice_is_a_model_failure(self):
        self.engine.model_clients[self.player] = ScriptedClient([], [])
        with self.assertRaises(ModelFailure):
            await self.engine.generate_arguments(self.player)


class ResignTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.players = (uuid4(), uuid4())
        with patch("app.engine.game_engine.OpenAIModelClient"):
            self.engine = GameEngine(uuid4(), self.players, "byom")
        self.engine.sides = dict(zip(self.players, ("pro", "con")))
        self.topic = SimpleNamespace(
            category="Cities", topic="Should transit be free?",
            pro_position="Transit should be free.", con_position="Transit should not be free.",
        )
        self.engine.judge_clients = SimpleNamespace(judge=AsyncMock(), client=SimpleNamespace(close=AsyncMock()))
        self.sockets = {player: Socket() for player in self.players}

    async def resign(self, player):
        reader = asyncio.create_task(self.engine.receive_messages(player, self.sockets[player], ConnectionActivity()))
        await self.sockets[player].messages.put({"type": "RESIGN", "payload": {}})
        await asyncio.sleep(0.01)
        reader.cancel()

    async def run_with(self, during_play):
        """Run the engine with `play` replaced by `during_play`, which runs until resigned or done."""
        for player in self.players:
            self.engine.connections[player] = self.sockets[player]
        with (
            patch("app.engine.game_engine.SessionFactory", return_value=AsyncMock()),
            patch("app.engine.game_engine.TopicRepository") as repo,
            patch.object(self.engine, "play", side_effect=during_play),
        ):
            repo.return_value.get_random_active = AsyncMock(return_value=self.topic)
            await self.engine.run()

    async def results(self, player):
        sent = []
        while not self.sockets[player].sent.empty():
            sent.append(await self.sockets[player].sent.get())
        return [message["payload"] for message in sent if message["type"] == "MATCH_RESULT"]

    async def test_resign_mid_match_forfeits_and_stops_play(self):
        resigner, opponent = self.players
        stopped = asyncio.Event()

        async def during_play():
            try:
                await self.resign(resigner)
                await asyncio.sleep(10)  # e.g. a long model turn or the judge call
            except asyncio.CancelledError:
                stopped.set()
                raise

        await asyncio.wait_for(self.run_with(during_play), 1)
        self.assertTrue(stopped.is_set())
        for player in self.players:
            [result] = await self.results(player)
            self.assertEqual(
                (result["winner"], result["status"], result["end_reason"]),
                ("con", "forfeited", "resigned"),
            )
        self.assertTrue(self.engine.finished.is_set())

    async def test_resign_after_result_is_ignored(self):
        async def during_play():
            await self.engine.broadcast_result({"winner": "pro", "reason": "Judged.", "status": "completed", "end_reason": "judged"})
            await self.resign(self.players[0])

        await self.run_with(during_play)
        [result] = await self.results(self.players[1])
        self.assertEqual(result["end_reason"], "judged")
        self.assertFalse(self.engine.resigned.is_set())

    async def test_later_outcome_cannot_replace_a_resignation(self):
        async def during_play():
            await self.resign(self.players[1])
            # play would normally be cancelled here; even if it gets further, its result is ignored.
            await self.engine.broadcast_result({"winner": "con", "reason": "Judged.", "status": "completed", "end_reason": "judged"})

        await self.run_with(during_play)
        results = await self.results(self.players[0])
        self.assertEqual([result["end_reason"] for result in results], ["resigned"])
        self.assertEqual(results[0]["winner"], "pro")
