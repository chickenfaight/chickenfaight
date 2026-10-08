import json
from base64 import b64encode
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from itsdangerous import TimestampSigner
from sqlalchemy import func, select

from app.config import settings
from app.models import User, UserSession
from app.services.auth_session import SESSION_LIFETIME, SessionService, hash_token

ME = "/auth/me"


def session_cookie(data: dict) -> str:
    """Sign a session payload the way Starlette's SessionMiddleware does."""
    payload = b64encode(json.dumps(data).encode())
    return TimestampSigner(settings.session_secret).sign(payload).decode()


def use_token(client, token) -> None:
    client.cookies.set("session", session_cookie({"session_token": token}))


async def count_sessions(db_session, user: User) -> int:
    return await db_session.scalar(
        select(func.count()).select_from(UserSession).where(UserSession.user_id == user.id)
    )


# AC1: a valid stored session signs the user in, validated by the backend.

async def test_valid_session_returns_user(client, make_user, db_session):
    user = await make_user("Rooster_42")
    use_token(client, await SessionService(db_session).start(user))
    response = await client.get(ME)
    assert response.status_code == 200
    assert response.json()["id"] == str(user.id)


async def test_google_sign_in_starts_a_session_that_auto_signs_in(client, db_session):
    google = SimpleNamespace(authorize_access_token=AsyncMock(return_value={
        "userinfo": {"sub": "google-123", "email": "hen@example.com", "email_verified": True, "name": "Henrietta Hen"},
    }))
    with patch("app.api.auth.oauth") as oauth:
        oauth.create_client.return_value = google
        response = await client.get("/auth/google/callback")
    assert response.status_code in (302, 307)
    user = await db_session.scalar(select(User).where(User.google_sub == "google-123"))
    assert await count_sessions(db_session, user) == 1
    assert (user.username, user.tag) == ("Henrietta Hen", None)  # Google name starts the username; tag comes later
    # The cookie from sign-in alone is enough on the next visit.
    assert (await client.get(ME)).json()["id"] == str(user.id)


async def test_only_the_token_hash_is_stored(client, make_user, db_session):
    user = await make_user("Rooster_42")
    token = await SessionService(db_session).start(user)
    stored = await db_session.scalar(select(UserSession).where(UserSession.user_id == user.id))
    assert stored.token_hash == hash_token(token)
    assert stored.token_hash != token
    assert timedelta(days=13) < stored.expires_at - datetime.now(timezone.utc) <= SESSION_LIFETIME


# AC2 and AC4: expired or invalid sessions are rejected by the backend, not trusted from the client.

async def test_missing_cookie_is_unauthorized(client):
    assert (await client.get(ME)).status_code == 401


async def test_unknown_token_is_unauthorized(client):
    use_token(client, "made-up-token")
    assert (await client.get(ME)).status_code == 401


async def test_malformed_session_payloads_are_unauthorized(client):
    for payload in [{"session_token": 123}, {"session_token": ""}, {"session_token": None}, {"user_id": "anything"}]:
        client.cookies.set("session", session_cookie(payload))
        assert (await client.get(ME)).status_code == 401


async def test_forged_cookie_is_unauthorized(client, make_user, db_session):
    user = await make_user("Rooster_42")
    token = await SessionService(db_session).start(user)
    payload = b64encode(json.dumps({"session_token": token}).encode())
    forged = TimestampSigner("not-the-server-secret").sign(payload).decode()
    client.cookies.set("session", forged)
    assert (await client.get(ME)).status_code == 401


async def test_expired_session_is_unauthorized(client, make_user, db_session):
    user = await make_user("Rooster_42")
    token = await SessionService(db_session).start(user)
    stored = await db_session.get(UserSession, hash_token(token))
    stored.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    await db_session.commit()
    use_token(client, token)
    assert (await client.get(ME)).status_code == 401


async def test_deleted_user_ends_their_sessions(client, make_user, db_session):
    user = await make_user("Rooster_42")
    token = await SessionService(db_session).start(user)
    await db_session.delete(user)
    await db_session.commit()
    use_token(client, token)
    assert (await client.get(ME)).status_code == 401


async def test_new_sign_in_cleans_up_expired_sessions(make_user, db_session):
    user = await make_user("Rooster_42")
    old = await SessionService(db_session).start(user)
    (await db_session.get(UserSession, hash_token(old))).expires_at = datetime.now(timezone.utc) - timedelta(days=1)
    await db_session.commit()
    await SessionService(db_session).start(user)
    assert await count_sessions(db_session, user) == 1
    assert await db_session.get(UserSession, hash_token(old)) is None


# AC3: logging out ends the session server-side, so the old cookie can't sign in again.

async def test_logout_revokes_the_token(client, make_user, db_session):
    user = await make_user("Rooster_42")
    token = await SessionService(db_session).start(user)
    use_token(client, token)
    assert (await client.post("/auth/logout")).status_code == 204
    assert await count_sessions(db_session, user) == 0
    # Even a copy of the old cookie no longer works.
    use_token(client, token)
    assert (await client.get(ME)).status_code == 401


async def test_logout_only_ends_that_session(client, make_user, db_session):
    user = await make_user("Rooster_42")
    phone = await SessionService(db_session).start(user)
    laptop = await SessionService(db_session).start(user)
    use_token(client, laptop)
    await client.post("/auth/logout")
    use_token(client, phone)
    assert (await client.get(ME)).status_code == 200


async def test_logout_without_a_session_succeeds(client):
    assert (await client.post("/auth/logout")).status_code == 204
