from dataclasses import replace
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import func, select
from app.models import Match, Rating
from app.services.result_outbox import ResultOutbox
from app.services.rewards import record_match
from test_result_atomicity import rated_report


async def test_commit_before_unlink_replays_once(db_session, rated_report, tmp_path):
    value, first, second = rated_report
    box = ResultOutbox(tmp_path)
    async def write(report):
        await record_match(db_session, report)
    with patch.object(box, '_discard', side_effect=OSError('crash before unlink')):
        assert not await box.record(value, write)
    assert list(tmp_path.glob('*.json'))
    assert await ResultOutbox(tmp_path).record(value, write)
    assert await db_session.scalar(select(func.count()).select_from(Match)) == 1
    assert all(row.games_played == 1 for row in await db_session.scalars(select(Rating)))
    await db_session.refresh(first)
    assert first.points == 70
    assert not list(tmp_path.glob('*.json'))


async def test_removed_catalog_does_not_poison_recovery(db_session, rated_report, tmp_path):
    value, first, second = rated_report
    value = replace(value, model_id=uuid4(), topic_id=uuid4(), rating_ladder_slug='removed-ladder')
    async def write(report):
        await record_match(db_session, report)
    assert await ResultOutbox(tmp_path).record(value, write)
    saved = await db_session.get(Match, value.match_id)
    assert saved.model_id is None and saved.topic_id is None
    await db_session.refresh(first)
    assert first.points == 70
