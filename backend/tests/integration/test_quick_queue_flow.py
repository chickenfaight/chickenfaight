"""Exercise HTTP registration, real catalogue queries, and match task lifecycle together."""
import asyncio
from contextlib import asynccontextmanager
from unittest.mock import patch

from app.engine.game_engine import GameEngine
from app.main import app
from app.models import Ladder


async def test_quick_queue_http_to_engine_and_completion(
    client, log_in, make_user, make_model, db_session,
):
    model = await make_model()
    db_session.add(Ladder(
        slug=f'ladder-{model.id}', display_name=model.display_name, kind='cloud', is_active=True,
    ))
    await db_session.commit()
    users = [await make_user(tag) for tag in ('QuickFirst', 'QuickSecond')]
    mm = app.state.matchmaker
    for user in users:
        log_in(user)
        response = await client.post('/v1/match/queue', json={'model_id': None})
        assert response.status_code == 202
        assert response.json() == {'status': 'queued'}
    assert not mm.queues  # No player has selected a model.

    @asynccontextmanager
    async def test_session():
        yield db_session

    started, finish = asyncio.Event(), asyncio.Event()

    async def run(game):
        started.set()
        await finish.wait()

    def choose(ids):
        assert model.id in ids  # Use the real repository result, not a mocked catalogue.
        return model.id

    with patch('app.services.matchmaking.SessionFactory', test_session), patch(
        'app.services.matchmaking.random.choice', side_effect=choose,
    ), patch.object(GameEngine, 'run', run):
        try:
            await mm.match_available_players()
            await asyncio.wait_for(started.wait(), timeout=1)
            [game] = mm.engines.values()
            assert game.model_id == model.id
            assert game.players == tuple(user.id for user in users)
            assert game.challenge_day is None
            assert not game.devices
            assert not mm.queued_users
            assert not mm.randomqueue
            for user in users:
                log_in(user)
                response = await client.get('/v1/match/status')
                assert response.json() == {'status': 'matched', 'match_id': str(game.match_id)}
                assert (await client.post('/v1/match/queue', json={'model_id': None})).status_code == 409

            await mm.match_available_players()
            assert list(mm.engines) == [game.match_id]
            finish.set()
            await asyncio.wait_for(asyncio.gather(*mm.tasks.values()), timeout=1)
            assert not mm.engines
            assert not mm.tasks
            assert not mm.assignments
            for user in users:
                log_in(user)
                assert (await client.get('/v1/match/status')).json() == {'status': 'none'}
        finally:
            await mm.close()
