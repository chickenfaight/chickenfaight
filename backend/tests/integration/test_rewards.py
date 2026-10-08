from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

from sqlalchemy import select

from app.models import ChallengeCompletion, Match, MatchParticipant
from app.services.rewards import MatchReport, effective_streak, points_rank, record_match

NOON = datetime(2026, 10, 8, 12, 0, tzinfo=UTC)


def report(pro, con, status="completed", winner="pro", end_reason="judged", when=NOON, challenge_day=None):
    return MatchReport(match_id=uuid4(), model_id=None, topic_id=None, challenge_day=challenge_day,
                       sides={pro.id: "pro", con.id: "con"},
                       result={"status": status, "winner": winner, "end_reason": end_reason, "reason": "Because."},
                       ended_at=when)


async def players(make_user):
    return await make_user("pro_hen"), await make_user("con_hen")


async def test_judged_match_rewards_both_and_the_winner_more(db_session, make_user):
    pro, con = await players(make_user)
    await record_match(db_session, report(pro, con))
    for user in (pro, con):
        await db_session.refresh(user)
    assert (pro.points, con.points) == (20, 10)
    assert (pro.streak, con.streak) == (1, 1)


async def test_result_and_participants_are_stored(db_session, make_user):
    pro, con = await players(make_user)
    r = report(pro, con)
    await record_match(db_session, r)
    match = await db_session.get(Match, r.match_id)
    assert (match.status, match.winner_side, match.end_reason) == ("completed", "pro", "judged")
    sides = {p.user_id: p.side for p in (await db_session.scalars(select(MatchParticipant).where(MatchParticipant.match_id == r.match_id)))}
    assert sides == {pro.id: "pro", con.id: "con"}


async def test_forfeit_rewards_only_the_winner(db_session, make_user):
    pro, con = await players(make_user)
    await record_match(db_session, report(pro, con, status="forfeited", winner="con", end_reason="resigned"))
    for user in (pro, con):
        await db_session.refresh(user)
    assert (pro.points, pro.streak, con.points) == (0, 0, 20)


async def test_void_rewards_nobody(db_session, make_user):
    pro, con = await players(make_user)
    await record_match(db_session, report(pro, con, status="voided", winner=None, end_reason="model_failure"))
    for user in (pro, con):
        await db_session.refresh(user)
    assert (pro.points, con.points, pro.streak) == (0, 0, 0)


async def test_streak_counts_new_days_only(db_session, make_user):
    pro, con = await players(make_user)
    for when in (NOON, NOON + timedelta(hours=3), NOON + timedelta(days=1), NOON + timedelta(days=2)):
        await record_match(db_session, report(pro, con, when=when))
    await db_session.refresh(pro)
    assert pro.streak == 3


async def test_streak_resets_after_48_hours(db_session, make_user):
    pro, con = await players(make_user)
    await record_match(db_session, report(pro, con, when=NOON))
    await record_match(db_session, report(pro, con, when=NOON + timedelta(days=1)))
    await record_match(db_session, report(pro, con, when=NOON + timedelta(days=1, hours=49)))
    await db_session.refresh(pro)
    assert pro.streak == 1
    assert effective_streak(pro, pro.last_played_at + timedelta(hours=47)) == 1
    assert effective_streak(pro, pro.last_played_at + timedelta(hours=49)) == 0


async def test_seventh_day_streak_bonus(db_session, make_user):
    pro, con = await players(make_user)
    for day in range(7):
        await record_match(db_session, report(pro, con, when=NOON + timedelta(days=day)))
    await db_session.refresh(con)
    assert con.streak == 7
    assert con.points == 7 * 10 + 25


async def test_daily_challenge_awards_once_per_day(db_session, make_user):
    pro, con = await players(make_user)
    day = NOON.date()
    await record_match(db_session, report(pro, con, challenge_day=day))
    await record_match(db_session, report(pro, con, challenge_day=day, when=NOON + timedelta(hours=1)))
    await db_session.refresh(pro)
    assert pro.points == 20 + 50 + 20  # two wins, one challenge award
    rows = (await db_session.scalars(select(ChallengeCompletion).where(ChallengeCompletion.user_id == pro.id))).all()
    assert [row.day for row in rows] == [day]


async def test_challenge_only_counts_on_its_own_day(db_session, make_user):
    pro, con = await players(make_user)
    await record_match(db_session, report(pro, con, challenge_day=date(2026, 10, 7)))  # ended the next day
    await db_session.refresh(pro)
    assert pro.points == 20


async def test_deleted_player_leaves_opponent_history(db_session, make_user):
    pro, con = await players(make_user)
    r = report(pro, con)
    await record_match(db_session, r)
    await db_session.delete(con)
    await db_session.commit()
    rows = (await db_session.scalars(select(MatchParticipant).where(MatchParticipant.match_id == r.match_id))).all()
    assert sorted((row.side, row.user_id) for row in rows) == [("con", None), ("pro", pro.id)]


async def test_rank_by_points_with_ties(db_session, make_user):
    a, b, c = await make_user("a_hen"), await make_user("b_hen"), await make_user("c_hen")
    a.points, b.points, c.points = 50, 50, 10
    await db_session.commit()
    assert [await points_rank(db_session, user) for user in (a, b, c)] == [1, 1, 3]
