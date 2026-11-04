import unittest
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from app.services.exceptions import AlreadyMatchedError, AlreadyQueuedError
from app.services.matchmaking import Matchmaker


class RegistrationTests(unittest.TestCase):
    def test_registration_preserves_queue_order_and_records_elo_and_join_time(self):
        matchmaker = Matchmaker()
        first, second = uuid4(), uuid4()
        model_id = uuid4()
        with patch('app.services.matchmaking.time.time', side_effect=[100.0, 101.0]):
            matchmaker.register(first, model_id, elo=1000)
            matchmaker.register(second, model_id, elo=1049)
        self.assertEqual(matchmaker.get_status(first), {"status": "queued"})
        self.assertEqual(matchmaker.get_status(second), {"status": "queued"})
        self.assertEqual(matchmaker.queues[(model_id, None)], [
            (first, 100.0, 1000), (second, 101.0, 1049),
        ])

    def test_duplicate_registration_does_not_add_another_entry(self):
        matchmaker = Matchmaker()
        user_id = uuid4()
        model_id, other_model_id = uuid4(), uuid4()
        matchmaker.register(user_id, model_id, elo=1000)
        with self.assertRaises(AlreadyQueuedError):
            matchmaker.register(user_id, other_model_id, elo=1100)
        [(queued_user, _, elo)] = matchmaker.queues[(model_id, None)]
        self.assertEqual((queued_user, elo), (user_id, 1000))
        self.assertNotIn((other_model_id, None), matchmaker.queues)
        self.assertEqual(matchmaker.queued_users, {user_id: (model_id, None)})

    def test_matched_user_cannot_register_again(self):
        matchmaker = Matchmaker()
        user_id, match_id = uuid4(), uuid4()
        matchmaker.assignments[user_id] = match_id
        with self.assertRaises(AlreadyMatchedError):
            matchmaker.register(user_id, uuid4(), elo=1000)
        self.assertFalse(matchmaker.queued_users)
        self.assertFalse(matchmaker.queues)
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
        matchmaker.register(user_id, uuid4(), elo=1000)
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

        self.user = User(id=uuid4(), google_sub="cancel-test")
        self.other = uuid4()
        self.model_id = uuid4()
        self.matchmaker = Matchmaker()
        self.matchmaker.register(self.user.id, self.model_id, elo=1000)
        self.matchmaker.register(self.other, self.model_id, elo=1025)
        self.caller_entry, self.other_entry = self.matchmaker.queues[(self.model_id, None)]
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
        self.assertEqual(self.matchmaker.queues[(self.model_id, None)], [self.other_entry])
        self.matchmaker.register(self.user.id, self.model_id, elo=1000)
        other_entry, (user_id, _, elo) = self.matchmaker.queues[(self.model_id, None)]
        self.assertEqual(other_entry, self.other_entry)
        self.assertEqual((user_id, elo), (self.user.id, 1000))

    def test_cancel_removes_user_from_only_the_selected_model_queue(self):
        other_model_id = uuid4()
        third = uuid4()
        self.matchmaker.register(third, other_model_id, elo=1100)
        [third_entry] = self.matchmaker.queues[(other_model_id, None)]
        self.assertEqual(self.client.delete('/match/queue').status_code, 204)
        self.assertEqual(self.matchmaker.queues[(self.model_id, None)], [self.other_entry])
        self.assertEqual(self.matchmaker.queues[(other_model_id, None)], [third_entry])
        self.assertEqual(self.matchmaker.queued_users, {self.other: (self.model_id, None), third: (other_model_id, None)})

    def test_user_can_choose_another_model_after_cancellation(self):
        other_model_id = uuid4()
        self.matchmaker.cancel(self.user.id)
        self.matchmaker.register(self.user.id, other_model_id, elo=1100)
        self.assertEqual(self.matchmaker.queues[(self.model_id, None)], [self.other_entry])
        [(user_id, _, elo)] = self.matchmaker.queues[(other_model_id, None)]
        self.assertEqual((user_id, elo), (self.user.id, 1100))

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
        self.assertEqual(self.matchmaker.queues[(self.model_id, None)], [self.caller_entry, self.other_entry])

    def test_delete_is_allowed_by_cors(self):
        from app.main import app
        from app.config import settings
        from fastapi.testclient import TestClient
        response = TestClient(app).options('/v1/match/queue', headers={
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
            matchmaker.register(user, uuid4(), elo=1000)
        with patch('app.services.matchmaking.GameEngine') as engine:
            await matchmaker.match_available_players()
            engine.assert_not_called()
        self.assertFalse(matchmaker.assignments)
        self.assertEqual(len(matchmaker.queued_users), 2)

    async def test_each_arena_pairs_eligible_players_in_order_and_completion_cleans_up(self):
        matchmaker = Matchmaker()
        model_a, model_b = uuid4(), uuid4()
        users = [uuid4() for _ in range(7)]
        for index, user in enumerate(users):
            matchmaker.register(user, model_a if index % 2 == 0 else model_b, elo=1000 + index)

        def fake_engine(match_id, players, model_id, challenge_day=None):
            return SimpleNamespace(match_id=match_id, players=players, model_id=model_id, devices={}, run=AsyncMock())

        with patch('app.services.matchmaking.GameEngine', side_effect=fake_engine) as engine:
            await matchmaker.match_available_players()
        pairs = [call.args[1] for call in engine.call_args_list]
        self.assertEqual(pairs, [(users[0], users[2]), (users[4], users[6]), (users[1], users[3])])
        self.assertEqual([call.args[2] for call in engine.call_args_list], [model_a, model_a, model_b])
        self.assertEqual(matchmaker.queued_users, {users[5]: (model_b, None)})
        [(queued_user, _, elo)] = matchmaker.queues[(model_b, None)]
        self.assertEqual((queued_user, elo), (users[5], 1005))
        self.assertEqual(len(matchmaker.engines), 3)
        self.assertEqual(matchmaker.assignments[users[0]], matchmaker.assignments[users[2]])
        self.assertNotEqual(matchmaker.assignments[users[0]], matchmaker.assignments[users[1]])
        await asyncio.gather(*matchmaker.tasks.values())
        self.assertFalse(matchmaker.assignments)
        self.assertFalse(matchmaker.engines)
        self.assertFalse(matchmaker.tasks)
        self.assertEqual(matchmaker.get_status(users[5]), {'status': 'queued'})

    async def test_pairs_within_elo_window_and_leaves_ineligible_player_queued(self):
        matchmaker = Matchmaker()
        first, ineligible, eligible = uuid4(), uuid4(), uuid4()
        model_id = uuid4()
        with patch('app.services.matchmaking.time.time', return_value=100.0):
            matchmaker.register(first, model_id, elo=1000)
            matchmaker.register(ineligible, model_id, elo=950)
            matchmaker.register(eligible, model_id, elo=1049)
            with patch('app.services.matchmaking.GameEngine') as engine, patch.object(matchmaker, 'start'):
                await matchmaker.match_available_players()

        engine.assert_called_once()
        self.assertEqual(engine.call_args.args[1], (first, eligible))
        self.assertEqual(matchmaker.queues[(model_id, None)], [(ineligible, 100.0, 950)])
        self.assertEqual(matchmaker.queued_users, {ineligible: (model_id, None)})

    async def test_elo_gap_of_50_requires_waiting_more_than_15_seconds(self):
        matchmaker = Matchmaker()
        first, second = uuid4(), uuid4()
        model_id = uuid4()
        with patch('app.services.matchmaking.time.time', return_value=100.0):
            matchmaker.register(first, model_id, elo=1050)
            matchmaker.register(second, model_id, elo=1000)
        original_queue = matchmaker.queues[(model_id, None)].copy()

        with patch('app.services.matchmaking.GameEngine') as engine, patch.object(matchmaker, 'start'):
            # Bound clock reads so a matchmaking pass that retries the same pair fails promptly.
            with patch('app.services.matchmaking.time.time', side_effect=[115.0] * 10):
                await matchmaker.match_available_players()
            engine.assert_not_called()
            self.assertEqual(matchmaker.queues[(model_id, None)], original_queue)
            self.assertEqual(matchmaker.queued_users, {first: (model_id, None), second: (model_id, None)})
            self.assertFalse(matchmaker.assignments)

            with patch('app.services.matchmaking.time.time', return_value=115.1):
                await matchmaker.match_available_players()
            engine.assert_called_once()
            self.assertEqual(engine.call_args.args[1], (first, second))
            self.assertFalse(matchmaker.queues[(model_id, None)])
            self.assertFalse(matchmaker.queued_users)


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
        self.user = User(id=uuid4(), google_sub='queue-test', tag='QueueUser')
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

    def mock_rating_lookup(self, elo):
        from app.models import Ladder, Rating

        ladder = Ladder(id=uuid4(), slug=f"ladder-{self.model_id}")
        ladder_result = MagicMock()
        ladder_result.scalars.return_value.one_or_none.return_value = ladder
        rating_result = MagicMock()
        rating_result.scalar_one_or_none.return_value = Rating(
            user_id=self.user.id, ladder_id=ladder.id, elo=elo,
        )
        self.session.execute.side_effect = [self.result, ladder_result, rating_result]

    def test_queue_body_selects_model_and_polling_sees_registration(self):
        self.mock_rating_lookup(elo=1234)
        response = self.client.post('/v1/match/queue', json={'model_id': str(self.model_id)})
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json(), {'status': 'queued'})
        self.assertEqual(self.client.get('/v1/match/status').json(), {'status': 'queued'})
        [(user_id, _, elo)] = self.matchmaker.queues[(self.model_id, None)]
        self.assertEqual((user_id, elo), (self.user.id, 1234))

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

    def test_queue_requires_tag(self):
        self.user.tag = None
        response = self.client.post('/v1/match/queue', json={'model_id': str(self.model_id)})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['code'], 'TAG_REQUIRED')
        self.session.execute.assert_not_awaited()

    def test_duplicate_queue_request_preserves_original_arena(self):
        original_model_id = uuid4()
        self.matchmaker.register(self.user.id, original_model_id, elo=1100)
        self.mock_rating_lookup(elo=1234)
        response = self.client.post('/v1/match/queue', json={'model_id': str(self.model_id)})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['code'], 'ALREADY_QUEUED')
        self.assertNotIn((self.model_id, None), self.matchmaker.queues)
        [(user_id, _, elo)] = self.matchmaker.queues[(original_model_id, None)]
        self.assertEqual((user_id, elo), (self.user.id, 1100))
        self.assertEqual(self.matchmaker.queued_users, {self.user.id: (original_model_id, None)})


class ByomPairingTests(unittest.TestCase):
    """`pair_byom`: same size class first, a neighboring class only after the wait, oldest first."""

    def entry(self, size_class, joined_at=0.0):
        from app.services.matchmaking import ByomEntry
        return ByomEntry(uuid4(), uuid4(), size_class, joined_at)

    def pair(self, entries, now):
        from app.services.matchmaking import pair_byom
        return pair_byom(entries, now, widen_after=30)

    def test_same_class_is_preferred_over_a_neighbor(self):
        small, medium, small_too = self.entry("small"), self.entry("medium"), self.entry("small", 5)
        self.assertEqual(self.pair([small, medium, small_too], now=100), [(small, small_too)])

    def test_neighbors_wait_before_pairing(self):
        small, medium = self.entry("small", 0), self.entry("medium", 10)
        self.assertEqual(self.pair([small, medium], now=29), [])
        self.assertEqual(self.pair([small, medium], now=30), [(small, medium)])

    def test_classes_two_apart_never_pair(self):
        self.assertEqual(self.pair([self.entry("small"), self.entry("large")], now=10_000), [])

    def test_longest_waiting_players_go_first(self):
        oldest, middle, newest = self.entry("medium", 0), self.entry("medium", 1), self.entry("medium", 2)
        self.assertEqual(self.pair([oldest, middle, newest], now=3), [(oldest, middle)])


class ByomMatchmakingTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        from app.services.bilc_connections import BilcConnections
        self.bilc = BilcConnections(record_hello=AsyncMock(), min_version="0.1.0", allow_dev=False)
        self.matchmaker = Matchmaker(bilc=self.bilc)

    def online(self, device_id):
        self.bilc.connections[device_id] = SimpleNamespace(identity=None)

    async def test_pairs_reserve_both_devices_and_start_a_byom_engine(self):
        users, devices = [uuid4(), uuid4()], [uuid4(), uuid4()]
        for user, device in zip(users, devices):
            self.online(device)
            self.matchmaker.register_byom(user, device, "small")
        with patch("app.services.matchmaking.GameEngine") as engine:
            engine.return_value = SimpleNamespace(match_id=uuid4(), players=tuple(users), devices={}, run=AsyncMock())
            await self.matchmaker.match_available_players()
        kwargs = engine.call_args.kwargs
        self.assertEqual(kwargs["devices"], dict(zip(users, devices)))
        self.assertIs(kwargs["bilc"], self.bilc)
        self.assertEqual({self.bilc.status(d) for d in devices}, {"busy"})
        self.assertFalse(self.matchmaker.byom_queue)
        self.assertEqual(self.matchmaker.get_status(users[0])["status"], "matched")

    async def test_offline_devices_wait_unpaired(self):
        users, devices = [uuid4(), uuid4()], [uuid4(), uuid4()]
        for user, device in zip(users, devices):
            self.matchmaker.register_byom(user, device, "small")
        self.online(devices[0])  # the other went offline after queueing
        with patch("app.services.matchmaking.GameEngine") as engine:
            await self.matchmaker.match_available_players()
        engine.assert_not_called()
        self.assertEqual(self.matchmaker.get_status(users[1]), {"status": "queued"})

    def test_byom_queue_can_be_cancelled(self):
        user = uuid4()
        self.matchmaker.register_byom(user, uuid4(), "large")
        with self.assertRaises(AlreadyQueuedError):
            self.matchmaker.register_byom(user, uuid4(), "large")
        self.matchmaker.cancel(user)
        self.assertFalse(self.matchmaker.byom_queue)
        self.assertEqual(self.matchmaker.get_status(user), {"status": "none"})
