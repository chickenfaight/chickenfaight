"""The caller's performance across all arenas, derived from saved results."""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Match, MatchParticipant, User
from app.models.match import MatchStatus
from app.schemas import ArenaStats


async def arena_stats(session: AsyncSession, user: User) -> ArenaStats:
    won = MatchParticipant.side == Match.winner_side
    results = (
        select(Match.id)
        .join(MatchParticipant, MatchParticipant.match_id == Match.id)
        .where(MatchParticipant.user_id == user.id,
               Match.status.in_([MatchStatus.COMPLETED, MatchStatus.FORFEITED]))
    )
    totals = await session.execute(results.with_only_columns(
        func.count(), func.count().filter(won),
    ))
    played, wins = totals.one()
    recent = await session.scalars(
        results.with_only_columns(won)
        .order_by(Match.ended_at.desc(), Match.id.desc()).limit(5)
    )
    return ArenaStats(
        points=user.points, debates_played=played, wins=wins,
        win_rate=100 * wins / played if played else None,
        recent_form=["W" if win else "L" for win in recent],
    )
