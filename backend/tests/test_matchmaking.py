import unittest
from uuid import uuid4

from app.services.exceptions import AlreadyMatchedError, AlreadyQueuedError
from app.services.matchmaking import Matchmaker


class RegistrationTests(unittest.TestCase):
    def test_registration_is_visible_to_polling_and_uses_fifo_order(self):
        matchmaker = Matchmaker()
        first, second = uuid4(), uuid4()
        matchmaker.register(first)
        matchmaker.register(second)
        self.assertEqual(matchmaker.get_status(first), {"status": "queued"})
        self.assertEqual(matchmaker.get_status(second), {"status": "queued"})
        self.assertEqual(list(matchmaker.queues["provided"]), [first, second])

    def test_duplicate_registration_does_not_add_another_entry(self):
        matchmaker = Matchmaker()
        user_id = uuid4()
        matchmaker.register(user_id)
        with self.assertRaises(AlreadyQueuedError):
            matchmaker.register(user_id)
        self.assertEqual(list(matchmaker.queues["provided"]), [user_id])
        self.assertEqual(matchmaker.queued_users, {user_id})

    def test_matched_user_cannot_register_again(self):
        matchmaker = Matchmaker()
        user_id, match_id = uuid4(), uuid4()
        matchmaker.assignments[user_id] = match_id
        with self.assertRaises(AlreadyMatchedError):
            matchmaker.register(user_id)
        self.assertFalse(matchmaker.queued_users)
        self.assertFalse(matchmaker.queues["provided"])
        self.assertEqual(matchmaker.get_status(user_id), {"status": "matched", "match_id": str(match_id)})

    def test_decided_match_is_no_longer_reported(self):
        # After a result (e.g. a resignation), the lobby must not send the player back into the match.
        from types import SimpleNamespace
        matchmaker = Matchmaker()
        user_id, match_id = uuid4(), uuid4()
        matchmaker.assignments[user_id] = match_id
        matchmaker.engines[match_id] = SimpleNamespace(result=None)
        self.assertEqual(matchmaker.get_status(user_id)["status"], "matched")
        matchmaker.engines[match_id].result = {"end_reason": "resigned"}
        self.assertEqual(matchmaker.get_status(user_id), {"status": "none"})
        matchmaker.register(user_id)
        self.assertEqual(matchmaker.get_status(user_id), {"status": "queued"})


class CancellationTests(unittest.TestCase):
    def setUp(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from starlette.middleware.sessions import SessionMiddleware
        from unittest.mock import AsyncMock
        from app.api.matchmaking import router
        from app.api.exception_handlers import register_exception_handlers
        from app.auth.dependencies import get_current_user
        from app.db.session import get_session
        from app.models.user import User

        self.user = User(id=uuid4(), google_sub="cancel-test", elo=1000)
        self.other = uuid4()
        self.matchmaker = Matchmaker()
        self.matchmaker.register(self.user.id)
        self.matchmaker.register(self.other)
        self.app = FastAPI()
        self.app.add_middleware(SessionMiddleware, secret_key="test-only")
        self.app.state.matchmaker = self.matchmaker
        self.app.include_router(router)
        register_exception_handlers(self.app)
        self.app.dependency_overrides[get_current_user] = lambda: self.user
        self.app.dependency_overrides[get_session] = lambda: AsyncMock()
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)

    def test_cancel_is_idempotent_and_only_removes_caller(self):
        for _ in range(2):
            response = self.client.delete('/match/queue')
            self.assertEqual(response.status_code, 204)
            self.assertEqual(response.content, b'')
        self.assertEqual(self.matchmaker.get_status(self.user.id), {'status': 'none'})
        self.assertEqual(list(self.matchmaker.queues['provided']), [self.other])
        self.matchmaker.register(self.user.id)
        self.assertEqual(list(self.matchmaker.queues['provided']), [self.other, self.user.id])

    def test_match_winning_race_returns_conflict_and_keeps_assignment(self):
        self.matchmaker.cancel(self.user.id)
        match_id = uuid4()
        self.matchmaker.assignments[self.user.id] = match_id
        response = self.client.delete('/match/queue')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['code'], 'IN_MATCH')
        self.assertEqual(self.matchmaker.assignments[self.user.id], match_id)

    def test_unauthenticated_cannot_cancel(self):
        from app.auth.dependencies import get_current_user
        del self.app.dependency_overrides[get_current_user]
        self.assertEqual(self.client.delete('/match/queue').status_code, 401)
        self.assertEqual(list(self.matchmaker.queues['provided']), [self.user.id, self.other])

    def test_delete_is_allowed_by_cors(self):
        from app.main import app
        from app.config import settings
        from fastapi.testclient import TestClient
        response = TestClient(app).options('/match/queue', headers={
            'Origin': settings.frontend_url,
            'Access-Control-Request-Method': 'DELETE',
        })
        self.assertEqual(response.status_code, 200)
        self.assertIn('DELETE', response.headers['access-control-allow-methods'])
