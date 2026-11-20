import json

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.main import app


LIMIT = 8 * 1024


@pytest.mark.parametrize(("method", "path"), [
    ("POST", "/auth/signup"),
    ("POST", "/auth/login"),
    ("POST", "/v1/bilc/register"),
    ("POST", "/v1/bilc/token"),
    ("PATCH", "/v1/users/me"),
])
async def test_declared_oversize_is_rejected_without_reading(method, path):
    read = False

    async def body():
        nonlocal read
        read = True
        yield b"{}"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
        response = await http.request(method, path, content=body(), headers={
            "Content-Type": "application/json",
            "Content-Length": str(LIMIT + 1),
            "Origin": settings.frontend_url,
        })

    assert response.status_code == 413
    assert response.json()["code"] == "BODY_TOO_LARGE"
    assert response.headers["access-control-allow-origin"] == settings.frontend_url
    assert not read


@pytest.mark.parametrize("length_header", [{}, {"Content-Length": str(LIMIT)}])
async def test_stream_stops_when_received_bytes_exceed_limit(length_header):
    async def body():
        yield b"{}"
        yield b" " * (LIMIT - 2)
        yield b" "
        pytest.fail("Request read continued after the byte limit")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
        response = await http.post("/auth/login", content=body(), headers={
            "Content-Type": "application/json",
            **length_header,
        })

    assert response.status_code == 413
    assert response.json()["code"] == "BODY_TOO_LARGE"


async def test_login_accepts_streamed_json_at_exact_byte_limit(client):
    credentials = {"tag": "Rooster_42", "password": "a test password 🐓"}
    assert (await client.post("/auth/signup", json={**credentials, "username": "Rooster"})).status_code == 204
    assert (await client.post("/auth/logout")).status_code == 204
    payload = json.dumps(credentials, ensure_ascii=False).encode()

    async def body():
        yield payload
        yield b" " * (LIMIT - len(payload))

    response = await client.post("/auth/login", content=body(), headers={"Content-Type": "application/json"})
    assert response.status_code == 204
    assert (await client.get("/auth/me")).json()["tag"] == credentials["tag"]
