"""The BILC socket after authentication: HELLO handshake, heartbeats, replacement, and bad frames."""
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.auth.bilc import BilcIdentity, get_bilc_identity
from app.main import app
from app.schemas import Hello
from app.services.bilc_connections import BilcConnections

WS = "/v1/bilc/ws"

HELLO = {"type": "HELLO", "payload": {
    "protocol_version": 1,
    "client_version": "0.1.0",
    "platform": "linux/amd64",
    "model": {"name": "llama3.2:3b", "context_length": 8192, "metadata": {"family": "llama"}},
}}


@pytest.fixture
def identity() -> BilcIdentity:
    return BilcIdentity(device_id=uuid4(), user_id=uuid4())


@pytest.fixture
def connections() -> BilcConnections:
    return BilcConnections(record_hello=AsyncMock())


@pytest.fixture
def socket_client(identity, connections):
    # Not `with TestClient(app)`: that runs startup, which migrates (and may reset) POSTGRES_URL.
    app.state.bilc_connections = connections
    app.dependency_overrides[get_bilc_identity] = lambda: identity
    yield TestClient(app)
    app.dependency_overrides.clear()


def say_hello(socket) -> dict:
    socket.send_json(HELLO)
    return socket.receive_json()


def test_hello_is_acknowledged_and_recorded(socket_client, identity, connections):
    with socket_client.websocket_connect(WS) as socket:
        assert say_hello(socket) == {"type": "HELLO_ACK", "payload": {"protocol_version": 1, "heartbeat_interval_s": 15}}
        assert connections.online(identity.user_id) == {identity.device_id}
        assert connections.online(uuid4()) == set()
    device_id, hello = connections.record_hello.await_args.args
    assert device_id == identity.device_id
    assert hello == Hello.model_validate(HELLO["payload"])


def test_device_goes_offline_when_it_disconnects(socket_client, identity, connections):
    with socket_client.websocket_connect(WS) as socket:
        say_hello(socket)
        socket.send_json({"type": "DISCONNECT", "payload": {"reason": "shutting down"}})
        with pytest.raises(WebSocketDisconnect) as closed:
            socket.receive_json()
        assert closed.value.code == 1000
    assert connections.online(identity.user_id) == set()


def test_hello_must_come_first(socket_client):
    with socket_client.websocket_connect(WS) as socket:
        socket.send_json({"type": "HEARTBEAT", "payload": {"ts": 1}})
        assert socket.receive_json()["payload"]["code"] == "BAD_MESSAGE"
        assert say_hello(socket)["type"] == "HELLO_ACK"


@pytest.mark.parametrize("frame", [
    "not json",
    "[1, 2]",
    '{"payload": {}}',
    '{"type": "HELLO", "payload": "nope"}',
])
def test_malformed_frames_get_bad_message_without_closing(socket_client, frame):
    with socket_client.websocket_connect(WS) as socket:
        socket.send_text(frame)
        assert socket.receive_json()["payload"]["code"] == "BAD_MESSAGE"
        assert say_hello(socket)["type"] == "HELLO_ACK"


@pytest.mark.parametrize("payload", [
    {**HELLO["payload"], "model": {"name": "", "metadata": {}}},
    {**HELLO["payload"], "client_version": "x" * 33},
    {**HELLO["payload"], "model": {"name": "big", "metadata": {"blob": "x" * 5000}}},
    {k: v for k, v in HELLO["payload"].items() if k != "model"},
])
def test_invalid_hello_is_rejected(socket_client, connections, payload):
    with socket_client.websocket_connect(WS) as socket:
        socket.send_json({"type": "HELLO", "payload": payload})
        assert socket.receive_json()["payload"]["code"] == "BAD_MESSAGE"
    connections.record_hello.assert_not_awaited()


def test_unsupported_protocol_version_closes_4426(socket_client):
    with socket_client.websocket_connect(WS) as socket:
        socket.send_json({"type": "HELLO", "payload": {**HELLO["payload"], "protocol_version": 2}})
        with pytest.raises(WebSocketDisconnect) as closed:
            socket.receive_json()
        assert closed.value.code == 4426


def test_unknown_type_does_not_close(socket_client):
    with socket_client.websocket_connect(WS) as socket:
        say_hello(socket)
        socket.send_json({"type": "MAKE_ME_ADMIN", "payload": {}})
        assert socket.receive_json()["payload"]["code"] == "UNKNOWN_TYPE"
        socket.send_json({"type": "HELLO", "payload": HELLO["payload"]})
        assert socket.receive_json()["payload"]["code"] == "BAD_MESSAGE"


def test_newer_connection_replaces_older(socket_client, identity, connections):
    with socket_client.websocket_connect(WS) as first:
        say_hello(first)
        with socket_client.websocket_connect(WS) as second:
            assert say_hello(second)["type"] == "HELLO_ACK"
            with pytest.raises(WebSocketDisconnect) as closed:
                first.receive_json()
            assert closed.value.code == 4409
            assert connections.online(identity.user_id) == {identity.device_id}


def test_heartbeats_are_sent_and_echoes_keep_it_open(socket_client, connections):
    connections.HEARTBEAT_INTERVAL = 0.05
    connections.HEARTBEAT_TIMEOUT = 0.5
    with socket_client.websocket_connect(WS) as socket:
        assert say_hello(socket)["payload"]["heartbeat_interval_s"] == 0.05
        for _ in range(3):
            beat = socket.receive_json()
            assert beat["type"] == "HEARTBEAT"
            socket.send_json(beat)


def test_silence_closes_4408(socket_client, connections):
    connections.HEARTBEAT_INTERVAL = 10
    connections.HEARTBEAT_TIMEOUT = 0.1
    with socket_client.websocket_connect(WS) as socket:
        say_hello(socket)
        with pytest.raises(WebSocketDisconnect) as closed:
            socket.receive_json()
        assert closed.value.code == 4408


def test_no_hello_closes_4408(socket_client, connections):
    connections.HEARTBEAT_TIMEOUT = 0.1
    with socket_client.websocket_connect(WS) as socket:
        with pytest.raises(WebSocketDisconnect) as closed:
            socket.receive_json()
        assert closed.value.code == 4408


def test_missing_token_closes_4401(connections):
    app.state.bilc_connections = connections
    with pytest.raises(WebSocketDisconnect) as closed:
        with TestClient(app).websocket_connect(WS):
            pass
    assert closed.value.code == 4401
