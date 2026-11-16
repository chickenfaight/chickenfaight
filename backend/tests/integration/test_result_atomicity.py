from dataclasses import replace
from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.models import ChallengeCompletion, Ladder, Match, MatchParticipant, Rating, Turn
from app.services.rating import RatingService
from app.services.rewards import record_match
from test_rewards import NOON, report


@pytest.fixture
async def rated_report(db_session, make_user, make_model):
    first, second = await make_user("atomic_first"), await make_user("atomic_second")
    model = await make_model()
    slug = f"ladder-{model.id}"
    db_session.add(Ladder(slug=slug, display_name="Atomic", kind="cloud"))
    await db_session.commit()
    r = replace(report(first, second, challenge_day=NOON.date()), model_id=model.id, rating_ladder_slug=slug,
                result={"status": "completed", "winner": "pro", "end_reason": "judged", "reason": "ok\x00",
                        "arguments": {"pro": "pro\x00", "con": "con"}})
    return r, first, second


@pytest.mark.parametrize("fail_at", [1, 2])
async def test_rating_failure_rolls_back_entire_result_and_can_retry(db_session, rated_report, fail_at):
    r, first, second = rated_report
    original = RatingService.calculate_and_update_elo
    calls = 0

    async def failing(self, *args):
        nonlocal calls
        calls += 1
        rating = await original(self, *args)
        if calls == fail_at:
            raise RuntimeError("injected write failure")
        return rating

    with patch.object(RatingService, "calculate_and_update_elo", failing):
        with pytest.raises(RuntimeError, match="injected"):
            await record_match(db_session, r)
    assert await db_session.get(Match, r.match_id) is None
    for model in (Rating, MatchParticipant, Turn, ChallengeCompletion):
        assert await db_session.scalar(select(func.count()).select_from(model)) == 0
    await db_session.refresh(first)
    await db_session.refresh(second)
    assert (first.points, second.points) == (0, 0)
    await db_session.commit()
    await record_match(db_session, r)
    await db_session.refresh(first)
    assert first.points == 70


async def test_replaying_report_is_idempotent_including_ratings(db_session, rated_report):
    r, first, second = rated_report
    await record_match(db_session, r)
    await record_match(db_session, r)
    await db_session.refresh(first)
    await db_session.refresh(second)
    assert (first.points, second.points) == (70, 60)
    ratings = list(await db_session.scalars(select(Rating)))
    assert sorted(row.elo for row in ratings) == [984, 1016]
    assert all(row.games_played == 1 for row in ratings)
    assert await db_session.scalar(select(func.count()).select_from(Turn)) == 2
    match = await db_session.get(Match, r.match_id)
    assert match.verdict_reasoning == "ok"
    assert sorted(await db_session.scalars(select(Turn.content))) == ["con", "pro"]


async def test_player_deleted_before_recording_keeps_opponent_result(db_session, rated_report):
    r, first, second = rated_report
    gone = second.id
    await db_session.delete(second)
    await db_session.commit()
    await record_match(db_session, r)
    participants = list(await db_session.scalars(select(MatchParticipant).where(MatchParticipant.match_id == r.match_id)))
    assert {p.user_id for p in participants} == {None, first.id}
    assert gone not in {p.user_id for p in participants}
    assert not list(await db_session.scalars(select(Rating)))


@pytest.mark.parametrize("winner,expected", [("pro", (1601, 999)), ("con", (1569, 1031)), (None, (1585, 1015))])
async def test_unequal_ratings_use_prematch_values_and_leave_other_ladder_alone(db_session, rated_report, winner, expected):
    r, first, second = rated_report
    ladder = await db_session.scalar(select(Ladder).where(Ladder.slug == r.rating_ladder_slug))
    other = Ladder(slug=f"other-{uuid4()}", display_name="Other", kind="cloud")
    db_session.add(other)
    await db_session.flush()
    db_session.add_all([
        Rating(user_id=first.id, ladder_id=ladder.id, elo=1600),
        Rating(user_id=second.id, ladder_id=ladder.id, elo=1000),
        Rating(user_id=first.id, ladder_id=other.id, elo=2222),
    ])
    await db_session.commit()
    await record_match(db_session, replace(r, result={**r.result, "winner": winner}))
    ratings = [await db_session.get(Rating, (u.id, ladder.id)) for u in (first, second)]
    assert tuple(rating.elo for rating in ratings) == expected
    assert all(rating.games_played == 1 for rating in ratings)
    untouched = await db_session.get(Rating, (first.id, other.id))
    assert (untouched.elo, untouched.games_played) == (2222, 0)
