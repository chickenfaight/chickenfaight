"""A BYOM match run by the real engine, with each player's turns on their own fake BILC device."""
import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from app.engine.game_engine import GameEngine
from app.schemas.schemas import Verdict
from app.services.arena import BYOM_ARENA_ID
from app.services.bilc_connections import BilcConnections
from fake_bilc import FakeBilc

TOPIC = SimpleNamespace(id=uuid4(), category="Cities", topic="Should transit be free?",
                        pro_position="Transit should be free.", con_position="Transit should not be free.")


class Player:
    """A browser in the match: records everything the engine sends it."""

    def __init__(self):
        self.sent: list[dict] = []

    async def send_json(self, message):
        self.sent.append(message)

    def types(self) -> list[str]:
        return [message["type"] for message in self.sent]


class Match:
    def __init__(self):
        self.connections = BilcConnections(record_hello=AsyncMock(), min_version="0.1.0", allow_dev=False)
        self.users = (uuid4(), uuid4())
        self.devices = {user: FakeBilc(user) for user in self.users}
        self.browsers = {user: Player() for user in self.users}
        self.engine: GameEngine | None = None
        self.judge = AsyncMock(return_value=Verdict(winner="pro", reason="Sharper."))

    async def start(self, scripts: dict[str, list]) -> dict[str, list[dict]]:
        """Connect both devices, set up the engine, and script each side's device replies."""
        for device in self.devices.values():
            assert (await device.connect(self.connections))["type"] == "HELLO_ACK"
        match_id = uuid4()
        for device in self.devices.values():
            assert self.connections.reserve(device.device_id, match_id)
        with patch("app.engine.game_engine.OpenAIModelClient"):
            self.engine = GameEngine(match_id, self.users, BYOM_ARENA_ID, bilc=self.connections,
                                     devices={user: device.device_id for user, device in self.devices.items()})
        self.engine.sides = dict(zip(self.users, ("pro", "con")))
        self.engine.judge_clients = SimpleNamespace(judge=self.judge, client=SimpleNamespace(close=AsyncMock()))
        for user, browser in self.browsers.items():
            self.engine.connections[user] = browser
            self.engine.prompts[user] = f"Strategy of {self.engine.sides[user]}"
            self.engine.prompt_received[user].set()
        self.engine.both_connected.set()
        return {side: self.device(side).reply_to_turns(script) for side, script in scripts.items()}

    def user(self, side: str):
        return next(user for user, s in self.engine.sides.items() if s == side)

    def device(self, side: str) -> FakeBilc:
        return self.devices[self.users[0] if side == "pro" else self.users[1]]

    async def run(self):
        @asynccontextmanager
        async def no_database():
            yield None

        with (
            patch("app.engine.game_engine.SessionFactory", no_database),
            patch("app.engine.game_engine.TopicRepository") as topics,
        ):
            topics.return_value.get_random_active = AsyncMock(return_value=TOPIC)
            await asyncio.wait_for(self.engine.run(), 10)

    def received(self, side: str) -> list[dict]:
        """The match messages the side's device got, apart from the handshake and turn requests."""
        return [m for m in self.device(side).seen if m["type"] not in ("HELLO_ACK", "TURN_REQUEST")]

    def received_types(self, side: str) -> list[str]:
        return [m["type"] for m in self.received(side)]

    async def stop(self):
        for device in self.devices.values():
            await device.stop()


@pytest.fixture
async def match():
    m = Match()
    yield m
    await m.stop()


async def test_each_turn_goes_to_its_players_device(match):
    requests = await match.start({"pro": [["Free ", "transit!"]], "con": [["Fares ", "fund it."]]})
    await match.run()

    for side, other in (("pro", "con"), ("con", "pro")):
        [request] = requests[side]
        content = request["messages"][0]["content"]
        assert f"Your side: {side}" in content and f"Strategy of {side}" in content
        assert f"Strategy of {other}" not in content  # never the opponent's prompt
    # Each browser streams its own side, then TURN_END.
    pro_browser = match.browsers[match.user("pro")]
    deltas = [m["payload"]["delta"] for m in pro_browser.sent if m["type"] == "TURN_DELTA"]
    assert deltas == ["Free ", "transit!"]
    assert pro_browser.types().index("TURN_END") > pro_browser.types().index("TURN_DELTA")
    assert match.browsers[match.user("pro")].sent[0]["payload"]["model_display_name"] == "Your model: llama3.2:3b"
    match.judge.assert_awaited_once_with(TOPIC, "Free transit!", "Fares fund it.")
    assert match.engine.result["status"] == "completed"
    for side in ("pro", "con"):
        assign, end = match.received(side)
        assert assign == {"type": "MATCH_ASSIGN", "payload": {
            "match_id": str(match.engine.match_id), "side": side, "topic": TOPIC.topic}}
        assert end == {"type": "MATCH_END", "payload": {"match_id": str(match.engine.match_id), "status": "completed"}}
        assert match.connections.status(match.device(side).device_id) == "idle"


async def test_device_error_forfeits_that_side_only(match):
    await match.start({"pro": [("ERROR", "MODEL_UNAVAILABLE")], "con": [["Fares ", "fund it."]]})
    await match.run()
    result = match.engine.result
    assert (result["status"], result["winner"], result["end_reason"]) == ("forfeited", "con", "model_failure")
    match.judge.assert_not_awaited()
    assert match.received_types("pro") == ["MATCH_ASSIGN", "FORFEIT", "MATCH_END"]
    assert match.received_types("con") == ["MATCH_ASSIGN", "MATCH_END"]
    for browser in match.browsers.values():
        assert browser.types()[-1] == "MATCH_RESULT"


async def test_silent_device_times_out_and_forfeits(match):
    await match.start({"pro": [None], "con": [["Fares ", "fund it."]]})
    match.engine.FIRST_TOKEN_TIMEOUT = 0.2
    await match.run()
    assert (match.engine.result["winner"], match.engine.result["end_reason"]) == ("con", "model_failure")
    _, forfeit, end = match.received("pro")
    assert forfeit["payload"]["reason"] == "MODEL_TIMEOUT" and end["type"] == "MATCH_END"


async def test_empty_output_forfeits(match):
    await match.start({"pro": [["Free ", "transit!"]], "con": [["   "]]})
    await match.run()
    assert match.engine.result["winner"] == "pro"


async def test_offline_device_forfeits_when_its_turn_comes(match):
    await match.start({"pro": [["Free ", "transit!"]]})
    con = match.device("con")
    con.hang_up()
    await asyncio.wait_for(con.task, 1)
    await match.run()
    assert (match.engine.result["winner"], match.engine.result["status"]) == ("pro", "forfeited")


async def test_when_both_devices_fail_the_outcome_matches_the_forfeits(match):
    # The first failure ends generation and cancels the other turn, so usually one side forfeits;
    # only failures in the same step void the match. Either way, FORFEIT goes to exactly the losers.
    await match.start({"pro": [("ERROR", "MODEL_ERROR")], "con": [("ERROR", "MODEL_ERROR")]})
    await match.run()
    result = match.engine.result
    forfeited = {side for side in ("pro", "con") if "FORFEIT" in match.received_types(side)}
    if result["status"] == "voided":
        assert result["winner"] is None and forfeited == {"pro", "con"}
    else:
        assert result["status"] == "forfeited" and forfeited == {"pro", "con"} - {result["winner"]}


async def test_match_ending_mid_turn_stops_the_device(match):
    await match.start({"pro": [None], "con": [None]})
    run = asyncio.create_task(match.run())
    await asyncio.sleep(0.1)  # both turns are in flight
    match.engine.resign(match.user("con"))
    await asyncio.wait_for(run, 5)
    assert match.engine.result["status"] == "forfeited"
    for side in ("pro", "con"):
        end = match.received(side)[-1]
        assert end == {"type": "MATCH_END", "payload": {"match_id": str(match.engine.match_id), "status": "forfeited"}}
        assert match.connections.status(match.device(side).device_id) == "idle"
        assert not match.connections.connections[match.device(side).device_id].turns
