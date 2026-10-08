import unittest
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from app.services.exceptions import AlreadyMatchedError, AlreadyQueuedError
from app.services.matchmaking import Matchmaker


class RegistrationTests(unittest.TestCase):
    def test_registration_is_visible_to_polling_and_uses_fifo_order(self):
        matchmaker = Matchmaker()
        first, second = uuid4(), uuid4()
        model_id = uuid4()
        matchmaker.register(first, model_id)
        matchmaker.register(second, model_id)
        self.assertEqual(matchmaker.get_status(first), {"status": "queued"})
        self.assertEqual(matchmaker.get_status(second), {"status": "queued"})
        self.assertEqual(list(matchmaker.queues[model_id]), [first, second])

    def test_duplicate_registration_does_not_add_another_entry(self):
        matchmaker = Matchmaker()
        user_id = uuid4()
        model_id, other_model_id = uuid4(), uuid4()
        matchmaker.register(user_id, model_id)
        with self.assertRaises(AlreadyQueuedError):
            matchmaker.register(user_id, other_model_id)
        self.assertEqual(list(matchmaker.queues[model_id]), [user_id])
        self.assertNotIn(other_model_id, matchmaker.queues)
        self.assertEqual(matchmaker.queued_users, {user_id: model_id})

    def test_matched_user_cannot_register_again(self):
        matchmaker = Matchmaker()
        user_id, match_id = uuid4(), uuid4()
        matchmaker.assignments[user_id] = match_id
        with self.assertRaises(AlreadyMatchedError):
            matchmaker.register(user_id, uuid4())
        self.assertFalse(matchmaker.queued_users)
        self.assertFalse(matchmaker.queues)
        self.assertEqual(matchmaker.get_status(user_id), {"status": "matched", "match_id": str(match_id)})


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
        self.model_id = uuid4()
        self.matchmaker = Matchmaker()
        self.matchmaker.register(self.user.id, self.model_id)
        self.matchmaker.register(self.other, self.model_id)
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
        self.assertEqual(list(self.matchmaker.queues[self.model_id]), [self.other])
        self.matchmaker.register(self.user.id, self.model_id)
        self.assertEqual(list(self.matchmaker.queues[self.model_id]), [self.other, self.user.id])

    def test_cancel_removes_user_from_only_the_selected_model_queue(self):
        other_model_id = uuid4()
        third = uuid4()
        self.matchmaker.register(third, other_model_id)
        self.assertEqual(self.client.delete('/match/queue').status_code, 204)
        self.assertEqual(list(self.matchmaker.queues[self.model_id]), [self.other])
        self.assertEqual(list(self.matchmaker.queues[other_model_id]), [third])
        self.assertEqual(self.matchmaker.queued_users, {self.other: self.model_id, third: other_model_id})

    def test_user_can_choose_another_model_after_cancellation(self):
        other_model_id = uuid4()
        self.matchmaker.cancel(self.user.id)
        self.matchmaker.register(self.user.id, other_model_id)
        self.assertEqual(list(self.matchmaker.queues[self.model_id]), [self.other])
        self.assertEqual(list(self.matchmaker.queues[other_model_id]), [self.user.id])

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
        self.assertEqual(list(self.matchmaker.queues[self.model_id]), [self.user.id, self.other])

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


class PairingTests(unittest.IsolatedAsyncioTestCase):
    async def test_players_in_different_arenas_do_not_match(self):
        matchmaker = Matchmaker()
        users = [uuid4(), uuid4()]
        for user in users:
            matchmaker.register(user, uuid4())
        with patch('app.services.matchmaking.GameEngine') as engine:
            await matchmaker.match_available_players()
            engine.assert_not_called()
        self.assertFalse(matchmaker.assignments)
        self.assertEqual(len(matchmaker.queued_users), 2)

    async def test_each_arena_pairs_fifo_and_completion_cleans_up(self):
        matchmaker = Matchmaker()
        model_a, model_b = uuid4(), uuid4()
        users = [uuid4() for _ in range(7)]
        for index, user in enumerate(users):
            matchmaker.register(user, model_a if index % 2 == 0 else model_b)

        def fake_engine(match_id, players, model_id):
            return SimpleNamespace(match_id=match_id, players=players, model_id=model_id, run=AsyncMock())

        with patch('app.services.matchmaking.GameEngine', side_effect=fake_engine) as engine:
            await matchmaker.match_available_players()
        pairs = [call.args[1] for call in engine.call_args_list]
        self.assertEqual(pairs, [(users[0], users[2]), (users[4], users[6]), (users[1], users[3])])
        self.assertEqual([call.kwargs['model_id'] for call in engine.call_args_list], [model_a, model_a, model_b])
        self.assertEqual(matchmaker.queued_users, {users[5]: model_b})
        self.assertEqual(list(matchmaker.queues[model_b]), [users[5]])
        self.assertEqual(len(matchmaker.engines), 3)
        self.assertEqual(matchmaker.assignments[users[0]], matchmaker.assignments[users[2]])
        self.assertNotEqual(matchmaker.assignments[users[0]], matchmaker.assignments[users[1]])
        await asyncio.gather(*matchmaker.tasks.values())
        self.assertFalse(matchmaker.assignments)
        self.assertFalse(matchmaker.engines)
        self.assertFalse(matchmaker.tasks)
        self.assertEqual(matchmaker.get_status(users[5]), {'status': 'queued'})


class QueueApiTests(unittest.TestCase):
    def setUp(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from starlette.middleware.sessions import SessionMiddleware
        from app.api.matchmaking import router
        from app.api.exception_handlers import register_exception_handlers
        from app.auth.dependencies import get_current_user
        from app.db.session import get_session
        from app.models import Model, User

        self.model_id = uuid4()
        self.user = User(id=uuid4(), google_sub='queue-test', username='QueueUser')
        self.matchmaker = Matchmaker()
        self.session = AsyncMock()
        self.result = MagicMock()
        self.result.scalar_one_or_none.return_value = Model(id=self.model_id, is_active=True)
        self.session.execute.return_value = self.result
        self.app = FastAPI()
        self.app.add_middleware(SessionMiddleware, secret_key='test-only')
        self.app.include_router(router, prefix='/v1')
        register_exception_handlers(self.app)
        self.app.state.matchmaker = self.matchmaker
        self.app.dependency_overrides[get_current_user] = lambda: self.user
        self.app.dependency_overrides[get_session] = lambda: self.session
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)

    def test_queue_body_selects_model_and_polling_sees_registration(self):
        response = self.client.post('/v1/match/queue', json={'model_id': str(self.model_id)})
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json(), {'status': 'queued'})
        self.assertEqual(self.client.get('/v1/match/status').json(), {'status': 'queued'})
        self.assertEqual(list(self.matchmaker.queues[self.model_id]), [self.user.id])

    def test_invalid_or_missing_model_id_does_not_register(self):
        for body in [{}, {'model_id': 'invalid'}, {'model_id': None}]:
            with self.subTest(body=body):
                response = self.client.post('/v1/match/queue', json=body)
                self.assertEqual(response.status_code, 422)
        self.assertEqual(self.client.post('/v1/match/queue').status_code, 422)
        self.session.execute.assert_not_awaited()
        self.assertFalse(self.matchmaker.queued_users)

    def test_unavailable_arena_is_rejected(self):
        self.result.scalar_one_or_none.return_value = None
        response = self.client.post('/v1/match/queue', json={'model_id': str(self.model_id)})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()['code'], 'NOT_FOUND')
        self.assertFalse(self.matchmaker.queues)

    def test_queue_requires_authentication(self):
        from app.auth.dependencies import get_current_user
        del self.app.dependency_overrides[get_current_user]
        response = self.client.post('/v1/match/queue', json={'model_id': str(self.model_id)})
        self.assertEqual(response.status_code, 401)
        self.session.execute.assert_not_awaited()
        self.assertFalse(self.matchmaker.queued_users)

    def test_queue_requires_username(self):
        self.user.username = None
        response = self.client.post('/v1/match/queue', json={'model_id': str(self.model_id)})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['code'], 'USERNAME_REQUIRED')
        self.session.execute.assert_not_awaited()

    def test_duplicate_queue_request_preserves_original_arena(self):
        self.matchmaker.register(self.user.id, uuid4())
        response = self.client.post('/v1/match/queue', json={'model_id': str(self.model_id)})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['code'], 'ALREADY_QUEUED')
        self.assertNotIn(self.model_id, self.matchmaker.queues)
