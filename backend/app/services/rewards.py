"""Match results, points, and streaks (US14). `record_match` runs once per decided match."""

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ChallengeCompletion, Match, MatchParticipant, Turn, User
from app.models.match import Phase
from app.services.challenge import CHALLENGE_POINTS

FINISH_POINTS = 10
WIN_POINTS = 10
STREAK_BONUS_EVERY = 7
STREAK_BONUS_POINTS = 25
STREAK_GRACE = timedelta(hours=48)


@dataclass(frozen=True)
class MatchReport:
    match_id: UUID
    model_id: UUID | None
    topic_id: UUID | None
    challenge_day: date | None
    sides: dict[UUID, str]  # user_id -> "pro" | "con"
    result: dict             # the MATCH_RESULT payload
    ended_at: datetime
    model_names: dict[UUID, str | None] = field(default_factory=dict)  # user_id -> the model they used
    truncated: frozenset[str] = frozenset()  # sides whose argument hit the length limit


def _storable(text: str) -> str:
    """Model output is untrusted, and a NUL byte makes Postgres reject the whole transaction,
    which would cost the players their result and points."""
    return text.replace("\x00", "")


def effective_streak(user: User, now: datetime) -> int:
    """The streak as shown: it lapses to 0 after 48 hours without finishing a match."""
    if user.last_played_at is None or now - user.last_played_at > STREAK_GRACE:
        return 0
    return user.streak


def _finishers(report: MatchReport) -> list[UUID]:
    """Players who finished: both in a judged match, only the winner of a forfeit, nobody in a void."""
    status, winner = report.result["status"], report.result.get("winner")
    if status == "completed":
        return list(report.sides)
    if status == "forfeited":
        return [user for user, side in report.sides.items() if side == winner]
    return []


def _advance_streak(user: User, now: datetime) -> int:
    """Update the streak for a match finished at `now`; returns any streak bonus points."""
    last = user.last_played_at
    if last is None or now - last > STREAK_GRACE:
        user.streak = 1
    elif last.date() < now.date():
        user.streak += 1
        if user.streak % STREAK_BONUS_EVERY == 0:
            return STREAK_BONUS_POINTS
    user.last_played_at = now
    return 0


async def record_match(session: AsyncSession, report: MatchReport) -> None:
    """Store the result and award points, streaks, and the daily challenge, in one transaction."""
    result = report.result
    async with session.begin():
        session.add(Match(
            id=report.match_id, model_id=report.model_id, topic_id=report.topic_id,
            status=result["status"], winner_side=result.get("winner"), end_reason=result["end_reason"],
            verdict_reasoning=_storable(result["reason"]) if result.get("reason") else None,
            challenge_day=report.challenge_day, ended_at=report.ended_at,
        ))
        # A player who deleted their account mid-match is saved as the deleted player they now are,
        # so the opponent keeps their result.
        existing = set(await session.scalars(select(User.id).where(User.id.in_(report.sides))))
        for user_id, side in report.sides.items():
            session.add(MatchParticipant(
                match_id=report.match_id, side=side, user_id=user_id if user_id in existing else None,
                model_name=report.model_names.get(user_id),
            ))
        for index, side in enumerate(("pro", "con")):
            content = _storable(result.get("arguments", {}).get(side, ""))
            if content.strip():
                session.add(Turn(
                    match_id=report.match_id, index=index, side=side, phase=Phase.OPENING,
                    content=content, truncated=side in report.truncated,
                ))
        await session.flush()

        for user_id in _finishers(report):
            # Lock the row: two of this player's matches could finish at the same moment.
            user = await session.get(User, user_id, with_for_update=True)
            if user is None:  # deleted mid-match
                continue
            user.points += FINISH_POINTS + _advance_streak(user, report.ended_at)
            if report.sides[user_id] == result.get("winner"):
                user.points += WIN_POINTS
            # "Completed in time": the challenge counts only on the day it was for.
            if report.challenge_day is not None and report.challenge_day == report.ended_at.date():
                awarded = await session.scalar(
                    insert(ChallengeCompletion)
                    .values(user_id=user_id, day=report.challenge_day, match_id=report.match_id)
                    .on_conflict_do_nothing()
                    .returning(ChallengeCompletion.user_id)
                )
                if awarded is not None:
                    user.points += CHALLENGE_POINTS


async def completed_challenge(session: AsyncSession, user_id: UUID, day: date) -> bool:
    return await session.get(ChallengeCompletion, (user_id, day)) is not None


async def points_rank(session: AsyncSession, user: User) -> int | None:
    """1-based position by points among tagged players (ties share a rank); None without a tag."""
    if user.tag is None:
        return None
    ahead = await session.scalar(
        select(func.count()).select_from(User).where(User.tag.is_not(None), User.points > user.points)
    )
    return ahead + 1
