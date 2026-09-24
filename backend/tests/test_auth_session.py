import unittest
from unittest.mock import AsyncMock
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from starlette.middleware.sessions import SessionMiddleware

from app.api.auth import router
from app.db.session import get_session
from app.models.user import User


class AuthSessionTests(unittest.TestCase):
    def setUp(self):
        self.user_id = uuid4()
        self.user = User(id=self.user_id, google_sub="test-google-sub", elo=0)
        self.session = AsyncMock()
        self.session.get.return_value = self.user

        app = FastAPI()
        app.add_middleware(SessionMiddleware, secret_key="test-only-session-key")
        app.include_router(router)

        async def test_session():
            yield self.session

        app.dependency_overrides[get_session] = test_session

        @app.post("/test/session")
        async def set_cookie(request: Request):
            # Reproduce the session payload written by the OAuth callback.
            request.session["user_id"] = (await request.json())["user_id"]
            return {"ok": True}

        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_uuid_cookie_returns_serialized_user(self):
        self.client.post("/test/session", json={"user_id": str(self.user_id)})
        response = self.client.get("/auth/me")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], str(self.user_id))
        self.session.get.assert_awaited_once_with(User, self.user_id)

    def test_missing_cookie_is_unauthorized(self):
        self.assertEqual(self.client.get("/auth/me").status_code, 401)
        self.session.get.assert_not_awaited()

    def test_invalid_ids_are_unauthorized(self):
        for user_id in ["invalid", 123, None, True, ""]:
            with self.subTest(user_id=user_id):
                self.client.post("/test/session", json={"user_id": user_id})
                self.assertEqual(self.client.get("/auth/me").status_code, 401)
        self.session.get.assert_not_awaited()

    def test_deleted_user_clears_session(self):
        self.session.get.return_value = None
        self.client.post("/test/session", json={"user_id": str(self.user_id)})
        self.assertEqual(self.client.get("/auth/me").status_code, 401)
        self.assertEqual(self.client.get("/auth/me").status_code, 401)
        self.session.get.assert_awaited_once()

    def test_logout_clears_session(self):
        self.client.post("/test/session", json={"user_id": str(self.user_id)})
        self.assertEqual(self.client.post("/auth/logout").status_code, 204)
        self.assertEqual(self.client.get("/auth/me").status_code, 401)
        self.session.get.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
