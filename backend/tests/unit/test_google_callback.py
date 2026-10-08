from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from starlette.middleware.sessions import SessionMiddleware

from app.api.auth import router
from app.db.session import get_session


@pytest.fixture
async def callback_client():
    # Failure callbacks never access the database. Use only the auth router,
    # without the real app's lifespan, which migrates the development database.
    app = FastAPI()
    app.add_middleware(SessionMiddleware, secret_key="test-secret")
    app.include_router(router)
    app.dependency_overrides[get_session] = lambda: None
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client


@pytest.mark.parametrize("query", [
    "error=access_denied&state=cancelled-state",
    "code=unused-code&state=invalid-state",
])
async def test_oauth_failure_redirects_to_login(callback_client, query):
    # Exercise Authlib itself: denied consent and invalid state must both stop
    # before exchanging a code or creating a user/session.
    with (
        patch("app.api.auth.settings", SimpleNamespace(frontend_url="https://web.example/")),
        patch("app.api.auth.UserService") as users,
        patch("app.api.auth.SessionService") as sessions,
    ):
        response = await callback_client.get(f"/auth/google/callback?{query}")
    assert response.status_code == 307
    assert response.headers["location"] == "https://web.example/login"
    assert "set-cookie" not in response.headers
    users.assert_not_called()
    sessions.assert_not_called()


@pytest.mark.parametrize("userinfo", [
    None,
    {"email": "hen@example.com", "email_verified": True},
    {"sub": "google-123", "email": "hen@example.com", "email_verified": False},
])
async def test_invalid_identity_redirects_to_login(callback_client, userinfo):
    google = SimpleNamespace(authorize_access_token=AsyncMock(return_value={"userinfo": userinfo}))
    with (
        patch("app.api.auth.oauth") as oauth,
        patch("app.api.auth.settings", SimpleNamespace(frontend_url="https://web.example")),
        patch("app.api.auth.UserService") as users,
        patch("app.api.auth.SessionService") as sessions,
    ):
        oauth.create_client.return_value = google
        response = await callback_client.get("/auth/google/callback")
    assert response.status_code == 307
    assert response.headers["location"] == "https://web.example/login"
    assert "set-cookie" not in response.headers
    users.assert_not_called()
    sessions.assert_not_called()
