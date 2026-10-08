from uuid import uuid4

import pytest

from app.repositories.arena import ArenaRepository


async def test_active_arena_lookup_filters_by_id_and_status(db_session, make_model):
    active = await make_model()
    other = await make_model()
    inactive = await make_model(is_active=False)
    repository = ArenaRepository(db_session)
    assert await repository.get_active_arena(active.id) is active
    assert await repository.get_active_arena(other.id) is other
    assert await repository.get_active_arena(inactive.id) is None
    assert await repository.get_active_arena(uuid4()) is None


@pytest.mark.parametrize('inactive', [False, True])
async def test_queue_rejects_unknown_or_inactive_model(client, log_in, make_user, make_model, inactive):
    log_in(await make_user('ArenaPlayer'))
    model_id = (await make_model(is_active=False)).id if inactive else uuid4()
    response = await client.post('/v1/match/queue', json={'model_id': str(model_id)})
    assert response.status_code == 404
    assert response.json()['code'] == 'NOT_FOUND'
    assert (await client.get('/v1/match/status')).json() == {'status': 'none'}
