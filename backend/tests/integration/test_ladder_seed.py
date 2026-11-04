"""Provisioning ladders, without which a cloud model can't be queued for."""
import logging

from sqlalchemy import func, select

from app.db.seed_ladders import cloud_ladder_slug, provision_ladders
from app.models import Ladder

QUEUE = "/v1/match/queue"


async def slugs(session) -> set[str]:
    found = set(await session.scalars(select(Ladder.slug)))
    await session.commit()
    return found


async def remove_ladders(session) -> None:
    for ladder in await session.scalars(select(Ladder)):
        await session.delete(ladder)
    await session.commit()


async def test_adds_a_ladder_per_active_model_and_one_byom_ladder(db_session, make_model):
    await remove_ladders(db_session)
    active, inactive = await make_model(), await make_model(is_active=False)
    assert await provision_ladders(db_session) >= 2
    found = await slugs(db_session)
    assert cloud_ladder_slug(active.id) in found and "byom-arena" in found
    assert cloud_ladder_slug(inactive.id) not in found
    ladder = await db_session.scalar(select(Ladder).where(Ladder.slug == cloud_ladder_slug(active.id)))
    await db_session.commit()
    assert (ladder.kind, ladder.provider_model_id) == ("cloud", active.api_model_id)


async def test_running_again_changes_nothing(db_session, make_model):
    await make_model()
    await provision_ladders(db_session)
    count = await db_session.scalar(select(func.count()).select_from(Ladder))
    await db_session.commit()
    assert await provision_ladders(db_session) == 0
    assert await db_session.scalar(select(func.count()).select_from(Ladder)) == count
    await db_session.commit()


async def test_a_model_with_a_new_id_gets_its_own_ladder(db_session, make_model):
    # The same API model imported under a new UUID, after an old ladder was left behind.
    model = await make_model()
    await remove_ladders(db_session)
    db_session.add(Ladder(slug="ladder-from-an-old-import", display_name="Old", kind="cloud", provider_model_id=model.api_model_id))
    await db_session.commit()
    await provision_ladders(db_session)
    assert cloud_ladder_slug(model.id) in await slugs(db_session)


async def test_missing_ladder_is_a_logged_404_and_provisioning_fixes_it(client, log_in, make_user, make_model, db_session, caplog):
    log_in(await make_user("player"))
    model = await make_model()
    await remove_ladders(db_session)
    with caplog.at_level(logging.WARNING, logger="app.api.matchmaking"):
        response = await client.post(QUEUE, json={"model_id": str(model.id)})
    assert response.status_code == 404 and response.json()["code"] == "NOT_FOUND"
    assert str(model.id) in caplog.text and "seed_ladders" in caplog.text
    await db_session.commit()
    await provision_ladders(db_session)
    response = await client.post(QUEUE, json={"model_id": str(model.id)})
    assert response.status_code == 202 and response.json() == {"status": "queued"}
