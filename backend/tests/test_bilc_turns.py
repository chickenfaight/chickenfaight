"""BilcConnections with a fake device: status and reservations, turn routing, match messages, versions."""
import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.inference.model_client import BilcModelClient, DeviceTurnError
from app.services import bilc_connections
from app.services.bilc_connections import BilcConnections
from fake_bilc import HELLO, FakeBilc

MESSAGES = [{"role": "system", "content": "Argue the pro side."}]


@pytest.fixture
async def connections():
    return BilcConnections(record_hello=AsyncMock(return_value=True), min_version="0.1.0", allow_dev=False)


@pytest.fixture
async def device(connections):
    fake = FakeBilc()
    assert (await fake.connect(connections))["type"] == "HELLO_ACK"
    yield fake
    await fake.stop()


async def collect(stream) -> list[str]:
    return [delta async for delta in stream]


# Status and reservations

async def test_status_follows_the_socket_and_reservations(connections, device):
    match_id = uuid4()
    assert connections.status(device.device_id) == "idle"
    assert connections.size_class(device.device_id) == "small"
    assert connections.reserve(device.device_id, match_id)
    assert connections.status(device.device_id) == "busy"
    assert not connections.reserve(device.device_id, uuid4())  # already busy
    connections.release(device.device_id, uuid4())  # another match's release changes nothing
    assert connections.status(device.device_id) == "busy"
    connections.release(device.device_id, match_id)
    assert connections.status(device.device_id) == "idle"
    assert connections.status(uuid4()) == "offline"
    assert not connections.reserve(uuid4(), match_id)


async def test_match_assign_and_end(connections, device):
    match_id = uuid4()
    connections.reserve(device.device_id, match_id)
    await connections.assign(device.device_id, match_id, "pro", "Should transit be free?")
    assert (await device.next("MATCH_ASSIGN"))["payload"] == {
        "match_id": str(match_id), "side": "pro", "topic": "Should transit be free?"}
    await connections.forfeit(device.device_id, match_id, "MODEL_TIMEOUT")
    assert (await device.next("FORFEIT"))["payload"] == {"match_id": str(match_id), "reason": "MODEL_TIMEOUT"}
    await connections.end_match(device.device_id, match_id, "forfeited")
    assert (await device.next("MATCH_END"))["payload"] == {"match_id": str(match_id), "status": "forfeited"}
    assert connections.status(device.device_id) == "idle"


async def test_reconnecting_mid_match_resends_the_assignment(connections, device):
    match_id = uuid4()
    connections.reserve(device.device_id, match_id)
    await connections.assign(device.device_id, match_id, "con", "Topic")
    await device.next("MATCH_ASSIGN")
    device.hang_up()
    await asyncio.wait_for(device.task, 1)
    assert connections.status(device.device_id) == "busy"  # still reserved while offline

    again = FakeBilc()
    again.identity = device.identity
    assert (await again.connect(connections))["type"] == "HELLO_ACK"
    assert (await again.next("MATCH_ASSIGN"))["payload"]["side"] == "con"
    await again.stop()


@pytest.mark.parametrize("account_deleted", [False, True], ids=["device-revoked", "account-deleted"])
async def test_revocation_closes_active_and_pending_sockets(connections, device, account_deleted):
    match_id = uuid4()
    assert connections.reserve(device.device_id, match_id)
    await connections.assign(device.device_id, match_id, "con", "Topic")
    if account_deleted:
        # The account-wide lookup must find devices with only pending sockets.
        device.hang_up()
        await asyncio.wait_for(device.task, 1)

    recording, resume = asyncio.Event(), asyncio.Event()

    async def record_hello(identity, hello):
        recording.set()
        await resume.wait()
        return True  # Authorization was valid when the HELLO transaction completed.

    connections.record_hello = record_hello
    waiting_for_hello, recording_hello = FakeBilc(), FakeBilc()
    pending = (waiting_for_hello, recording_hello)
    try:
        for socket in pending:
            socket.task = asyncio.create_task(connections.serve(device.identity, socket))
            socket.say("HEARTBEAT", {"ts": 1})
            assert (await socket.next("ERROR"))["payload"]["code"] == "BAD_MESSAGE"

        recording_hello.say("HELLO", HELLO)
        await asyncio.wait_for(recording.wait(), 1)
        if account_deleted:
            await connections.close_user(device.identity.user_id)
        else:
            await connections.close(device.device_id, 4403, "Device revoked")
            assert device.close_code == 4403
        assert all(socket.close_code == 4403 for socket in pending)

        resume.set()
        await asyncio.wait_for(asyncio.gather(*(socket.task for socket in pending)), 1)
        assert not connections.online(device.identity.user_id)
        assert not connections.pending
        assert all([message["type"] for message in socket.seen] == ["ERROR"] for socket in pending)
        with pytest.raises(DeviceTurnError) as failed:
            await collect(connections.turn(device.device_id, match_id, MESSAGES, 400))
        assert failed.value.code == "BILC_OFFLINE"
    finally:
        resume.set()
        await asyncio.gather(*(socket.stop() for socket in pending))


# Turns

async def test_turn_streams_the_devices_response(connections, device):
    match_id = uuid4()
    sent = device.reply_to_turns([["Opening ", "argument."]])
    deltas = await collect(BilcModelClient(connections, device.device_id, match_id).stream(MESSAGES, 400))
    assert deltas == ["Opening ", "argument."]
    [request] = sent
    assert request["match_id"] == str(match_id) and request["phase"] == "opening"
    assert request["messages"] == MESSAGES and request["max_tokens"] == 400
    deadline = datetime.fromisoformat(request["deadline"]) - datetime.now(timezone.utc)
    assert timedelta(seconds=80) < deadline <= timedelta(seconds=90)
    assert not connections.connections[device.device_id].turns


@pytest.mark.parametrize(("code", "expected"), [
    ("MODEL_UNAVAILABLE", "MODEL_UNAVAILABLE"),
    ("FUTURE_ERROR", "MODEL_ERROR"),
])
async def test_device_error_fails_the_turn(connections, device, code, expected):
    device.reply_to_turns([("ERROR", code)])
    with pytest.raises(DeviceTurnError) as failed:
        await collect(connections.turn(device.device_id, uuid4(), MESSAGES, 400))
    assert failed.value.code == expected
    assert "local model failed" not in str(failed.value)  # the fake device's diagnostic


@pytest.mark.parametrize(("code", "expected"), [
    ("BILC_BUSY", "BILC_BUSY"),
    ("Unexpected\ncode", "MODEL_ERROR"),
    ("Unexpected\x1bcode", "MODEL_ERROR"),
])
async def test_unsolicited_device_errors_log_only_known_codes(device, caplog, code, expected):
    with caplog.at_level("INFO", logger=bilc_connections.__name__):
        device.say("ERROR", {"code": code})
        device.say("HELLO", HELLO)
        assert (await device.next("ERROR"))["payload"]["code"] == "BAD_MESSAGE"

    assert caplog.messages == [f"BILC {device.device_id} reported {expected}"]


@pytest.mark.parametrize("deltas", [
    pytest.param(["é" * 5], id="delta-bytes"),
    pytest.param(["é" * 4, "é" * 3], id="buffered-bytes"),
    pytest.param([""] * 4, id="buffered-frames"),
])
async def test_over_budget_response_fails_a_paused_turn(connections, device, monkeypatch, deltas):
    monkeypatch.setattr(bilc_connections, "MAX_TURN_DELTA_BYTES", 8)
    monkeypatch.setattr(bilc_connections, "MAX_TURN_BUFFER_BYTES", 12)
    monkeypatch.setattr(bilc_connections, "MAX_TURN_BUFFER_FRAMES", 3)
    stream = connections.turn(device.device_id, uuid4(), MESSAGES, 200)
    first = asyncio.create_task(anext(stream))
    turn_id = (await device.next("TURN_REQUEST"))["payload"]["turn_id"]
    device.say("MATCH_RESPONSE", {"turn_id": turn_id, "delta": "start"})
    assert await asyncio.wait_for(first, 1) == "start"

    # Hold the consumer at its first yield until the socket reader processes this batch.
    for delta in deltas:
        device.say("MATCH_RESPONSE", {"turn_id": turn_id, "delta": delta})
    device.say("MATCH_RESPONSE", {"turn_id": turn_id, "delta": "late", "done": True})
    device.say("BARRIER", {})
    assert (await device.next("ERROR"))["payload"]["code"] == "UNKNOWN_TYPE"

    assert not connections.connections[device.device_id].turns
    with pytest.raises(DeviceTurnError, match="over-budget") as failed:
        await asyncio.wait_for(anext(stream), 1)
    assert failed.value.code == "MODEL_ERROR"

    # The device can still complete another turn on the same connection.
    device.reply_to_turns([["okay"]])
    assert await asyncio.wait_for(collect(connections.turn(device.device_id, uuid4(), MESSAGES, 200)), 1) == ["okay"]


async def test_consumed_deltas_free_buffer_budget(connections, device, monkeypatch):
    monkeypatch.setattr(bilc_connections, "MAX_TURN_DELTA_BYTES", 8)
    monkeypatch.setattr(bilc_connections, "MAX_TURN_BUFFER_BYTES", 8)
    monkeypatch.setattr(bilc_connections, "MAX_TURN_BUFFER_FRAMES", 1)
    stream = connections.turn(device.device_id, uuid4(), MESSAGES, 200)
    first = asyncio.create_task(anext(stream))
    turn_id = (await device.next("TURN_REQUEST"))["payload"]["turn_id"]
    delta = "🦆" * 2
    device.say("MATCH_RESPONSE", {"turn_id": turn_id, "delta": delta})
    assert await asyncio.wait_for(first, 1) == delta

    # Exactly one full-size response fits again, including text in the terminal frame.
    device.say("MATCH_RESPONSE", {"turn_id": turn_id, "delta": delta, "done": True})
    device.say("MATCH_RESPONSE", {"turn_id": turn_id, "delta": "ignored"})
    device.say("BARRIER", {})
    assert (await device.next("ERROR"))["payload"]["code"] == "UNKNOWN_TYPE"
    assert await asyncio.wait_for(collect(stream), 1) == [delta]


@pytest.mark.parametrize("disconnect", [False, True])
async def test_a_full_buffer_can_deliver_a_terminal_error(connections, device, monkeypatch, disconnect):
    monkeypatch.setattr(bilc_connections, "MAX_TURN_BUFFER_FRAMES", 1)
    stream = connections.turn(device.device_id, uuid4(), MESSAGES, 200)
    first = asyncio.create_task(anext(stream))
    turn_id = (await device.next("TURN_REQUEST"))["payload"]["turn_id"]
    device.say("MATCH_RESPONSE", {"turn_id": turn_id, "delta": "start"})
    assert await asyncio.wait_for(first, 1) == "start"

    device.say("MATCH_RESPONSE", {"turn_id": turn_id, "delta": "queued"})
    if disconnect:
        device.hang_up()
        await asyncio.wait_for(device.task, 1)
        code = "BILC_DISCONNECTED"
    else:
        device.say("ERROR", {"turn_id": turn_id, "code": "MODEL_UNAVAILABLE"})
        device.say("BARRIER", {})
        assert (await device.next("ERROR"))["payload"]["code"] == "UNKNOWN_TYPE"
        code = "MODEL_UNAVAILABLE"

    assert await asyncio.wait_for(anext(stream), 1) == "queued"
    with pytest.raises(DeviceTurnError) as failed:
        await asyncio.wait_for(anext(stream), 1)
    assert failed.value.code == code


async def test_disconnect_mid_turn_fails_the_turn(connections, device):
    stream = connections.turn(device.device_id, uuid4(), MESSAGES, 400)
    pending = asyncio.ensure_future(collect(stream))
    await device.next("TURN_REQUEST")
    device.hang_up()
    with pytest.raises(DeviceTurnError) as failed:
        await asyncio.wait_for(pending, 1)
    assert failed.value.code == "BILC_DISCONNECTED"


async def test_offline_device_fails_at_once(connections):
    with pytest.raises(DeviceTurnError) as failed:
        await collect(connections.turn(uuid4(), uuid4(), MESSAGES, 400))
    assert failed.value.code == "BILC_OFFLINE"


async def test_responses_for_unknown_or_abandoned_turns_are_ignored(connections, device):
    stream = connections.turn(device.device_id, uuid4(), MESSAGES, 400)
    first = asyncio.ensure_future(anext(stream))
    turn_id = (await device.next("TURN_REQUEST"))["payload"]["turn_id"]
    device.say("MATCH_RESPONSE", {"turn_id": str(uuid4()), "delta": "intruder", "done": False})
    device.say("MATCH_RESPONSE", {"turn_id": turn_id, "delta": "mine", "done": False})
    assert await asyncio.wait_for(first, 1) == "mine"
    await stream.aclose()  # the engine gave up on the turn
    assert not connections.connections[device.device_id].turns
    device.say("MATCH_RESPONSE", {"turn_id": turn_id, "delta": "late", "done": True})
    device.say("HEARTBEAT", {"ts": 1})  # still connected, nothing sent back for the late reply
    await asyncio.sleep(0.05)
    assert device.outbox.empty() and device.close_code is None


async def test_malformed_match_response_gets_bad_message(connections, device):
    device.say("MATCH_RESPONSE", {"turn_id": "not-a-uuid", "delta": "x"})
    assert (await device.next("ERROR"))["payload"]["code"] == "BAD_MESSAGE"


# Versions

async def test_outdated_client_is_told_to_update():
    connections = BilcConnections(record_hello=AsyncMock(), min_version="0.2.0", allow_dev=False)
    fake = FakeBilc()
    fake.task = asyncio.create_task(connections.serve(fake.identity, fake))
    fake.say("HELLO", HELLO)  # 0.1.0
    await asyncio.wait_for(fake.task, 1)
    assert fake.close_code == 4426 and "bilc update" in fake.close_reason
    assert connections.status(fake.device_id) == "offline"


@pytest.mark.parametrize(("allow_dev", "accepted"), [(True, True), (False, False)])
async def test_dev_builds_only_in_development(allow_dev, accepted):
    connections = BilcConnections(record_hello=AsyncMock(), min_version="0.1.0", allow_dev=allow_dev)
    fake = FakeBilc()
    fake.task = asyncio.create_task(connections.serve(fake.identity, fake))
    fake.say("HELLO", {**HELLO, "client_version": "dev"})
    if accepted:
        assert (await fake.next())["type"] == "HELLO_ACK"
        await fake.stop()
    else:
        await asyncio.wait_for(fake.task, 1)
        assert fake.close_code == 4426
