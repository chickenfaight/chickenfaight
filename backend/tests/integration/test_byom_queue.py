"""Queueing for the BYOM arena: it needs one of the caller's own connected, idle devices."""
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.main import app
from app.schemas import Hello
from app.services.arena import BYOM_ARENA_ID
from fake_bilc import HELLO

QUEUE = "/v1/match/queue"


async def paired_device(client, log_in, owner) -> str:
    log_in(owner)
    code = (await client.post("/v1/bilc/pairing-codes")).json()["code"]
    body = {"pairing_code": code, "device_name": "laptop", "platform": "linux/amd64", "client_version": "0.1.0"}
    return (await client.post("/v1/bilc/register", json=body)).json()["bilc_id"]


def connect(device_id: str, owner, parameter_size="14B"):
    """Mark the device connected, as if its socket had said HELLO."""
    hello = Hello.model_validate({**HELLO, "model": {**HELLO["model"], "metadata": {"parameter_size": parameter_size}}})
    from uuid import UUID
    app.state.bilc_connections.connections[UUID(device_id)] = SimpleNamespace(
        identity=SimpleNamespace(device_id=UUID(device_id), user_id=owner.id), hello=hello)


async def test_arena_list_includes_byom(client, log_in, make_user):
    log_in(await make_user("viewer"))
    arenas = (await client.get("/v1/arenas")).json()
    assert {"id": str(BYOM_ARENA_ID), "display_name": "Bring your own model", "kind": "byom"} in arenas


async def test_queue_with_an_idle_device(client, log_in, make_user):
    owner = await make_user("owner")
    device_id = await paired_device(client, log_in, owner)
    connect(device_id, owner, "14B")
    response = await client.post(QUEUE, json={"model_id": str(BYOM_ARENA_ID), "bilc_id": device_id})
    assert response.status_code == 202 and response.json() == {"status": "queued"}
    [entry] = app.state.matchmaker.byom_queue
    assert (str(entry.device_id), entry.size_class) == (device_id, "medium")
    devices = (await client.get("/v1/bilc/devices")).json()
    assert (devices[0]["status"], devices[0]["size_class"]) == ("idle", "medium")


async def test_offline_device_cannot_queue(client, log_in, make_user):
    owner = await make_user("owner")
    device_id = await paired_device(client, log_in, owner)
    response = await client.post(QUEUE, json={"model_id": str(BYOM_ARENA_ID), "bilc_id": device_id})
    assert response.status_code == 409
    assert response.json()["code"] == "BILC_OFFLINE" and "bilc run" in response.json()["detail"]
    assert not app.state.matchmaker.byom_queue


async def test_busy_device_cannot_queue(client, log_in, make_user):
    owner = await make_user("owner")
    device_id = await paired_device(client, log_in, owner)
    connect(device_id, owner)
    from uuid import UUID
    app.state.bilc_connections.reserve(UUID(device_id), uuid4())
    response = await client.post(QUEUE, json={"model_id": str(BYOM_ARENA_ID), "bilc_id": device_id})
    assert response.status_code == 409 and response.json()["code"] == "BILC_BUSY"


async def test_someone_elses_device_is_not_found(client, log_in, make_user):
    owner = await make_user("owner")
    device_id = await paired_device(client, log_in, owner)
    connect(device_id, owner)
    log_in(await make_user("intruder"))
    response = await client.post(QUEUE, json={"model_id": str(BYOM_ARENA_ID), "bilc_id": device_id})
    assert response.status_code == 404 and response.json()["code"] == "NOT_FOUND"


@pytest.mark.parametrize("body", [
    {"model_id": str(BYOM_ARENA_ID)},
    {"model_id": str(BYOM_ARENA_ID), "bilc_id": str(uuid4()), "daily": True},
])
async def test_byom_needs_a_device_and_no_daily(client, log_in, make_user, body):
    log_in(await make_user("owner"))
    response = await client.post(QUEUE, json=body)
    assert response.status_code == 422 and response.json()["code"] == "VALIDATION_ERROR"


async def test_cloud_arenas_take_no_device(client, log_in, make_user, make_model):
    log_in(await make_user("owner"))
    model = await make_model()
    response = await client.post(QUEUE, json={"model_id": str(model.id), "bilc_id": str(uuid4())})
    assert response.status_code == 422


async def test_byom_queue_requires_a_tag(client, log_in, make_user):
    log_in(await make_user())
    response = await client.post(QUEUE, json={"model_id": str(BYOM_ARENA_ID), "bilc_id": str(uuid4())})
    assert response.status_code == 403 and response.json()["code"] == "TAG_REQUIRED"
