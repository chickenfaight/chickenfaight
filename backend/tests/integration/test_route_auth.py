"""Which routes are public, enforced for every route the app serves (PROTOCOL.md marks the public ones)."""
import re
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.auth.dependencies import get_websocket_user_id
from app.config import settings
from app.main import app
from app.services.matchmaking import Matchmaker

# The only routes that work without a session. Adding a route here needs a reason in PROTOCOL.md.
PUBLIC = {
    ("GET", "/health"),
    ("GET", "/auth/google/login"),
    ("GET", "/auth/google/callback"),
    ("POST", "/auth/logout"),
    ("POST", "/auth/signup"),
    ("POST", "/auth/login"),
}


def every_http_route() -> list[tuple[str, str]]:
    return sorted(
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        for method in operations
    )


def concrete(path: str) -> str:
    return re.sub(r"\{[^}]+\}", str(uuid4()), path)


@pytest.mark.parametrize(("method", "path"), [r for r in every_http_route() if r not in PUBLIC])
async def test_route_requires_a_session(client, method, path):
    body = {} if method in ("POST", "PUT", "PATCH") else None
    response = await client.request(method, concrete(path), json=body)
    assert response.status_code == 401, f"{method} {path} is reachable without signing in"


@pytest.mark.parametrize(("method", "path"), sorted(PUBLIC))
async def test_public_route_does_not_require_a_session(client, method, path):
    response = await client.request(method, path, follow_redirects=False)
    assert response.status_code != 401


def test_public_list_matches_the_app():
    # A stale entry here would make a removed route look covered.
    assert PUBLIC <= set(every_http_route())


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
async def test_api_docs_follow_app_env(client, path):
    # The test app loads `.env`; docs exist only when APP_ENV is development.
    expected = 200 if settings.app_env == "development" else 404
    assert (await client.get(path)).status_code == expected


async def test_cors_rejects_other_origins(client):
    response = await client.get("/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in response.headers


async def test_cors_allows_the_frontend_with_credentials(client):
    origin = settings.frontend_url.rstrip("/")
    response = await client.get("/health", headers={"Origin": origin})
    assert response.headers["access-control-allow-origin"] == origin
    assert response.headers["access-control-allow-credentials"] == "true"


# Match WebSocket: authenticated and authorized before accept().

@pytest.fixture
def socket_client():
    # Not `with TestClient(app)`: that runs startup, which migrates (and in development may reset)
    # the real database in POSTGRES_URL.
    app.state.matchmaker = Matchmaker()
    yield TestClient(app)
    app.dependency_overrides.clear()


def close_code(socket_client, match_id, origin):
    headers = {"origin": origin} if origin else {}
    with pytest.raises(WebSocketDisconnect) as closed:
        with socket_client.websocket_connect(f"/v1/game/{match_id}/ws", headers=headers):
            pass
    return closed.value.code


def test_socket_rejects_unauthenticated(socket_client):
    assert close_code(socket_client, uuid4(), settings.frontend_url.rstrip("/")) == 4401


@pytest.mark.parametrize("origin", ["https://evil.example", None])
def test_socket_rejects_other_origins(socket_client, origin):
    assert close_code(socket_client, uuid4(), origin) == 4403


def test_socket_rejects_players_not_in_the_match(socket_client):
    user_id, their_match, other_match = uuid4(), uuid4(), uuid4()
    app.dependency_overrides[get_websocket_user_id] = lambda: user_id
    app.state.matchmaker.assignments[user_id] = their_match
    assert close_code(socket_client, other_match, settings.frontend_url.rstrip("/")) == 4403
