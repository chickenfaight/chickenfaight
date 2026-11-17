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


async def test_quick_queue_catalogue_requires_active_model_and_cloud_ladder(db_session, make_model):
    from app.models import Ladder

    playable = await make_model()
    missing_ladder = await make_model()
    inactive_model = await make_model(is_active=False)
    inactive_ladder = await make_model()
    byom_ladder = await make_model()
    for model, active, kind in [
        (playable, True, 'cloud'), (inactive_model, True, 'cloud'),
        (inactive_ladder, False, 'cloud'), (byom_ladder, True, 'byom'),
    ]:
        db_session.add(Ladder(
            slug=f'ladder-{model.id}', display_name=model.display_name,
            kind=kind, is_active=active,
        ))
    await db_session.commit()
    ids = await ArenaRepository(db_session).get_queueable_model_ids()
    assert playable.id in ids
    assert not {missing_ladder.id, inactive_model.id, inactive_ladder.id, byom_ladder.id} & set(ids)
