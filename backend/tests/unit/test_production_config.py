"""Fresh-process config checks; no lifespan, migrations, or database connection."""
import os
import subprocess
import sys


def test_production_cookie_docs_and_cors_configuration():
    script = '''
import asyncio
from unittest.mock import AsyncMock, patch
from httpx import ASGITransport, AsyncClient
from app.main import app
from app.db.session import get_session
from app.models import User
from uuid import uuid4

app.dependency_overrides[get_session] = lambda: None
async def check():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://api.example") as client:
        for path in ("/docs", "/redoc", "/openapi.json"):
            assert (await client.get(path)).status_code == 404
        with patch("app.api.auth.UserService") as users, patch("app.api.auth.SessionService") as sessions:
            users.return_value.create_account = AsyncMock(return_value=User(id=uuid4(), tag="test_player"))
            sessions.return_value.start = AsyncMock(return_value="test-session-token")
            response = await client.post("/auth/signup", json={"tag":"test_player","username":"Player","password":"test-password"})
        assert response.status_code == 204
        cookie = response.headers["set-cookie"].lower()
        assert "secure" in cookie and "httponly" in cookie and "samesite=lax" in cookie
        assert "max-age=1209600" in cookie
        good = await client.options("/v1/users/me", headers={"Origin":"https://web.example","Access-Control-Request-Method":"PATCH","Access-Control-Request-Headers":"content-type"})
        assert good.status_code == 200
        assert good.headers["access-control-allow-origin"] == "https://web.example"
        bad = await client.options("/v1/users/me", headers={"Origin":"https://evil.example","Access-Control-Request-Method":"PATCH"})
        assert bad.status_code == 400 and "access-control-allow-origin" not in bad.headers
asyncio.run(check())
'''
    env = {**os.environ, "APP_ENV": "production", "SECURE_COOKIES": "true", "FRONTEND_URL": "https://web.example"}
    result = subprocess.run([sys.executable, "-c", script], env=env, capture_output=True, text=True, timeout=10)
    assert result.returncode == 0, result.stderr
