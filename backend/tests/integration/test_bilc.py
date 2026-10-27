"""BILC pairing and auth: pairing codes, registration, refresh-token rotation, devices, and the socket's token check."""
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import jwt
import pytest
from fastapi import WebSocketException
from sqlalchemy import select

from app.auth.bilc import BilcIdentity, decode_access_token, get_bilc_identity, issue_access_token
from app.config import settings
from app.main import app
from app.models import BilcDevice, BilcPairingCode
from app.services.auth_session import hash_token
from app.services.bilc import PAIRING_CODE_ALPHABET

CODES = "/v1/bilc/pairing-codes"
REGISTER = "/v1/bilc/register"
TOKEN = "/v1/bilc/token"
DEVICES = "/v1/bilc/devices"


async def new_code(client) -> str:
    response = await client.post(CODES)
    assert response.status_code == 200
    return response.json()["code"]


def device_body(code: str, **overrides) -> dict:
    return {"pairing_code": code, "device_name": "Ryan's laptop", "platform": "linux/amd64",
            "client_version": "0.1.0", **overrides}


async def pair(client, log_in, owner) -> dict:
    """Pair a device for `owner`; returns `{bilc_id, refresh_token}`."""
    log_in(owner)
    response = await client.post(REGISTER, json=device_body(await new_code(client)))
    assert response.status_code == 200
    return response.json()


async def refresh(client, paired: dict):
    return await client.post(TOKEN, json={"bilc_id": paired["bilc_id"], "refresh_token": paired["refresh_token"]})


# POST /v1/bilc/pairing-codes

async def test_pairing_code_format_and_expiry(client, log_in, make_user):
    log_in(await make_user("owner"))
    before = datetime.now(timezone.utc)
    body = (await client.post(CODES)).json()
    assert len(body["code"]) == 8 and set(body["code"]) <= set(PAIRING_CODE_ALPHABET)
    expires_at = datetime.fromisoformat(body["expires_at"])
    assert before + timedelta(minutes=9) < expires_at <= datetime.now(timezone.utc) + timedelta(minutes=10)


async def test_pairing_code_is_stored_hashed(client, log_in, make_user, db_session):
    owner = await make_user("owner")
    log_in(owner)
    code = await new_code(client)
    stored = (await db_session.scalars(select(BilcPairingCode).where(BilcPairingCode.user_id == owner.id))).all()
    assert [row.code_hash for row in stored] == [hash_token(code)]


async def test_new_code_clears_used_and_expired_codes(client, log_in, make_user, db_session):
    owner = await make_user("owner")
    log_in(owner)
    used = await new_code(client)
    await client.post(REGISTER, json=device_body(used))
    db_session.add(BilcPairingCode(code_hash="0" * 64, user_id=owner.id,
                                   expires_at=datetime.now(timezone.utc) - timedelta(minutes=1)))
    await db_session.commit()
    fresh = await new_code(client)
    hashes = (await db_session.scalars(select(BilcPairingCode.code_hash).where(BilcPairingCode.user_id == owner.id))).all()
    assert hashes == [hash_token(fresh)]


async def test_pairing_codes_are_rate_limited(client, log_in, make_user):
    log_in(await make_user("owner"))
    statuses = [(await client.post(CODES)).status_code for _ in range(6)]
    assert statuses == [200] * 5 + [429]


# POST /v1/bilc/register

async def test_register_creates_a_device_for_the_code_owner(client, log_in, make_user, db_session):
    owner = await make_user("owner")
    paired = await pair(client, log_in, owner)
    device = await db_session.get(BilcDevice, paired["bilc_id"])
    assert device.user_id == owner.id
    assert (device.name, device.platform, device.client_version) == ("Ryan's laptop", "linux/amd64", "0.1.0")
    # Only the hash is stored.
    assert device.refresh_token_hash == hash_token(paired["refresh_token"])
    assert paired["refresh_token"] not in str(device.__dict__)


async def test_pairing_code_works_once(client, log_in, make_user):
    log_in(await make_user("owner"))
    code = await new_code(client)
    assert (await client.post(REGISTER, json=device_body(code))).status_code == 200
    response = await client.post(REGISTER, json=device_body(code))
    assert response.status_code == 400
    assert response.json()["code"] == "PAIRING_CODE_INVALID"


async def test_expired_pairing_code_is_rejected(client, log_in, make_user, db_session):
    log_in(await make_user("owner"))
    code = await new_code(client)
    row = await db_session.get(BilcPairingCode, hash_token(code))
    row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    await db_session.commit()
    response = await client.post(REGISTER, json=device_body(code))
    assert response.status_code == 400
    assert response.json()["code"] == "PAIRING_CODE_INVALID"


async def test_wrong_pairing_code_is_rejected(client):
    response = await client.post(REGISTER, json=device_body("ZZZZ2222"))
    assert response.status_code == 400
    assert response.json()["code"] == "PAIRING_CODE_INVALID"


async def test_pairing_code_ignores_case_and_grouping(client, log_in, make_user):
    log_in(await make_user("owner"))
    code = await new_code(client)
    typed = f" {code[:4].lower()}-{code[4:].lower()} "
    assert (await client.post(REGISTER, json=device_body(typed))).status_code == 200


@pytest.mark.parametrize("overrides", [
    {"device_name": ""},
    {"device_name": "   "},
    {"device_name": "evil\u202Ename"},
    {"device_name": "x" * 65},
    {"platform": "lin\nux"},
    {"client_version": "1" * 33},
    {"pairing_code": "A" * 17},
])
async def test_register_rejects_bad_device_info(client, log_in, make_user, overrides):
    log_in(await make_user("owner"))
    code = await new_code(client)
    assert (await client.post(REGISTER, json=device_body(code, **overrides))).status_code == 422


async def test_register_is_rate_limited_per_ip(client):
    statuses = [(await client.post(REGISTER, json=device_body("ZZZZ2222"))).status_code for _ in range(11)]
    assert statuses == [400] * 10 + [429]


# POST /v1/bilc/token

async def test_token_issues_access_jwt_and_rotates(client, log_in, make_user, db_session):
    owner = await make_user("owner")
    paired = await pair(client, log_in, owner)
    response = await refresh(client, paired)
    assert response.status_code == 200
    body = response.json()
    identity = decode_access_token(body["access_token"])
    assert identity == BilcIdentity(device_id=UUID(paired["bilc_id"]), user_id=owner.id)
    claims = jwt.decode(body["access_token"], settings.bilc_jwt_secret, algorithms=["HS256"], audience="bilc")
    assert claims["exp"] - claims["iat"] == 15 * 60
    assert body["refresh_token"] != paired["refresh_token"]
    device = await db_session.get(BilcDevice, paired["bilc_id"])
    await db_session.refresh(device)
    assert device.refresh_token_hash == hash_token(body["refresh_token"])


async def test_rotated_tokens_keep_working_in_order(client, log_in, make_user):
    paired = await pair(client, log_in, await make_user("owner"))
    for _ in range(3):
        response = await refresh(client, paired)
        assert response.status_code == 200
        paired["refresh_token"] = response.json()["refresh_token"]


async def test_reusing_a_rotated_token_revokes_the_device(client, log_in, make_user, db_session):
    paired = await pair(client, log_in, await make_user("owner"))
    newer = (await refresh(client, paired)).json()["refresh_token"]
    # The device is connected; reuse must cut it off too.
    socket = SimpleNamespace(identity=None, close=AsyncMock(), hello=None)
    app.state.bilc_connections.connections[UUID(paired["bilc_id"])] = socket

    reused = await refresh(client, paired)
    assert reused.status_code == 401
    assert reused.json()["code"] == "TOKEN_INVALID"
    socket.close.assert_awaited_once_with(4403, "Device revoked")
    # Even the newest token is dead now.
    assert (await refresh(client, {**paired, "refresh_token": newer})).status_code == 401
    device = await db_session.get(BilcDevice, paired["bilc_id"])
    await db_session.refresh(device)
    assert device.revoked_at is not None and device.refresh_token_hash is None


async def test_wrong_token_is_rejected_without_revoking(client, log_in, make_user):
    paired = await pair(client, log_in, await make_user("owner"))
    response = await refresh(client, {**paired, "refresh_token": "guess"})
    assert response.status_code == 401
    assert response.json()["code"] == "TOKEN_INVALID"
    assert (await refresh(client, paired)).status_code == 200


async def test_refresh_token_expires_after_30_days_unused(client, log_in, make_user, db_session):
    paired = await pair(client, log_in, await make_user("owner"))
    device = await db_session.get(BilcDevice, paired["bilc_id"])
    assert timedelta(days=29) < device.refresh_token_expires_at - datetime.now(timezone.utc) <= timedelta(days=30)
    device.refresh_token_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    await db_session.commit()
    response = await refresh(client, paired)
    assert response.status_code == 401
    assert response.json()["code"] == "TOKEN_INVALID"


async def test_rotation_extends_the_refresh_token(client, log_in, make_user, db_session):
    paired = await pair(client, log_in, await make_user("owner"))
    device = await db_session.get(BilcDevice, paired["bilc_id"])
    device.refresh_token_expires_at = datetime.now(timezone.utc) + timedelta(minutes=1)
    await db_session.commit()
    assert (await refresh(client, paired)).status_code == 200
    await db_session.refresh(device)
    assert device.refresh_token_expires_at - datetime.now(timezone.utc) > timedelta(days=29)


async def test_unknown_device_token_is_rejected(client):
    response = await refresh(client, {"bilc_id": str(uuid4()), "refresh_token": "anything"})
    assert response.status_code == 401
    assert response.json()["code"] == "TOKEN_INVALID"


async def test_token_rejects_malformed_body(client):
    assert (await client.post(TOKEN, json={"bilc_id": "not-a-uuid", "refresh_token": "x"})).status_code == 422


# GET /v1/bilc/devices, DELETE /v1/bilc/devices/{id}

async def test_devices_lists_only_callers_active_devices(client, log_in, make_user):
    owner, other = await make_user("owner"), await make_user("other")
    mine = await pair(client, log_in, owner)
    revoked = await pair(client, log_in, owner)
    await pair(client, log_in, other)
    log_in(owner)
    assert (await client.delete(f"{DEVICES}/{revoked['bilc_id']}")).status_code == 204
    devices = (await client.get(DEVICES)).json()
    assert [device["id"] for device in devices] == [mine["bilc_id"]]
    assert set(devices[0]) == {"id", "name", "platform", "client_version", "model_name", "size_class", "online",
                               "status", "last_seen_at", "created_at"}
    assert devices[0]["online"] is False and devices[0]["status"] == "offline"
    assert devices[0]["model_name"] is None and devices[0]["size_class"] is None


async def test_devices_show_online_and_model(client, log_in, make_user, db_session):
    owner = await make_user("owner")
    paired = await pair(client, log_in, owner)
    device_id = UUID(paired["bilc_id"])
    device = await db_session.get(BilcDevice, device_id)
    device.model_metadata = {"name": "llama3.2:3b", "context_length": None, "metadata": {}}
    await db_session.commit()
    app.state.bilc_connections.connections[device_id] = SimpleNamespace(
        identity=BilcIdentity(device_id=device_id, user_id=owner.id), close=AsyncMock(), hello=None,
    )
    [listed] = (await client.get(DEVICES)).json()
    assert listed["online"] is True and listed["status"] == "idle"
    assert listed["model_name"] == "llama3.2:3b" and listed["size_class"] == "large"  # size not reported


async def test_revoke_disconnects_and_blocks_refresh(client, log_in, make_user):
    owner = await make_user("owner")
    paired = await pair(client, log_in, owner)
    socket = SimpleNamespace(identity=None, close=AsyncMock(), hello=None)
    app.state.bilc_connections.connections[UUID(paired["bilc_id"])] = socket
    assert (await client.delete(f"{DEVICES}/{paired['bilc_id']}")).status_code == 204
    socket.close.assert_awaited_once_with(4403, "Device revoked")
    response = await refresh(client, paired)
    assert response.status_code == 401
    assert response.json()["code"] == "TOKEN_INVALID"


async def test_cannot_revoke_someone_elses_device(client, log_in, make_user):
    paired = await pair(client, log_in, await make_user("owner"))
    log_in(await make_user("intruder"))
    response = await client.delete(f"{DEVICES}/{paired['bilc_id']}")
    assert response.status_code == 404
    assert response.json()["code"] == "NOT_FOUND"
    assert (await refresh(client, paired)).status_code == 200


async def test_revoke_unknown_or_malformed_device(client, log_in, make_user):
    log_in(await make_user("owner"))
    assert (await client.delete(f"{DEVICES}/{uuid4()}")).status_code == 404
    assert (await client.delete(f"{DEVICES}/not-a-uuid")).status_code == 422


async def test_deleting_the_account_deletes_its_devices(client, log_in, make_user, db_session):
    owner = await make_user("owner")
    paired = await pair(client, log_in, owner)
    assert (await client.delete("/v1/users/me")).status_code == 204
    assert (await refresh(client, paired)).status_code == 401
    db_session.expunge_all()
    assert await db_session.get(BilcDevice, paired["bilc_id"]) is None


# The socket's token check (before accept)

@pytest.fixture
def use_test_db(db_session):
    @asynccontextmanager
    async def factory():
        yield db_session

    with patch("app.auth.bilc.SessionFactory", factory):
        yield


def handshake(authorization: str | None) -> SimpleNamespace:
    return SimpleNamespace(headers={"authorization": authorization} if authorization else {})


async def close_code(authorization: str | None) -> int:
    with pytest.raises(WebSocketException) as rejected:
        await get_bilc_identity(handshake(authorization))
    return rejected.value.code


def forged(claims: dict, secret: str = settings.bilc_jwt_secret) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": str(uuid4()), "uid": str(uuid4()), "aud": "bilc", "exp": now + timedelta(minutes=5),
                       **claims}, secret, algorithm="HS256")


async def access_token(client, paired) -> str:
    return (await refresh(client, paired)).json()["access_token"]


async def test_socket_accepts_a_valid_token(client, log_in, make_user, use_test_db):
    owner = await make_user("owner")
    paired = await pair(client, log_in, owner)
    identity = await get_bilc_identity(handshake(f"Bearer {await access_token(client, paired)}"))
    assert identity == BilcIdentity(device_id=UUID(paired["bilc_id"]), user_id=owner.id)


@pytest.mark.parametrize("authorization", [
    None,
    "Bearer",
    "Basic abc",
    "Bearer not-a-jwt",
    "Bearer " + forged({}, secret="someone-elses-secret-that-is-long-enough"),
    "Bearer " + forged({"aud": "web"}),
    "Bearer " + forged({"exp": datetime.now(timezone.utc) - timedelta(seconds=1)}),
    "Bearer " + forged({"sub": "not-a-uuid"}),
    "Bearer " + jwt.encode({"sub": str(uuid4()), "uid": str(uuid4()), "aud": "bilc"},
                           settings.bilc_jwt_secret, algorithm="HS256"),  # no exp
    "Bearer " + jwt.encode({"sub": str(uuid4()), "uid": str(uuid4()), "aud": "bilc",
                            "exp": datetime.now(timezone.utc) + timedelta(minutes=5)}, None, algorithm="none"),
])
async def test_socket_rejects_bad_tokens(authorization):
    assert await close_code(authorization) == 4401


async def test_socket_rejects_unknown_device(use_test_db):
    token, _ = issue_access_token(BilcIdentity(device_id=uuid4(), user_id=uuid4()), datetime.now(timezone.utc))
    assert await close_code(f"Bearer {token}") == 4401


async def test_socket_rejects_revoked_device(client, log_in, make_user, use_test_db):
    paired = await pair(client, log_in, await make_user("owner"))
    token = await access_token(client, paired)
    await client.delete(f"{DEVICES}/{paired['bilc_id']}")
    assert await close_code(f"Bearer {token}") == 4403


async def test_socket_rejects_a_device_playing_for_another_user(client, log_in, make_user, use_test_db):
    paired = await pair(client, log_in, await make_user("owner"))
    device_id = UUID(paired["bilc_id"])
    token, _ = issue_access_token(BilcIdentity(device_id=device_id, user_id=uuid4()), datetime.now(timezone.utc))
    assert await close_code(f"Bearer {token}") == 4403
