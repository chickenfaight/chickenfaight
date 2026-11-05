from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Match, MatchParticipant, Topic, Turn, User


class MatchRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    def _players_matches(self, user_id: UUID):
        return (
            select(Match, MatchParticipant, Topic)
            .join(MatchParticipant, MatchParticipant.match_id == Match.id)
            .outerjoin(Topic, Topic.id == Match.topic_id)
            .where(MatchParticipant.user_id == user_id)
        )

    async def list_for_player(self, user_id: UUID, limit: int, offset: int) -> list[tuple[Match, MatchParticipant, Topic | None]]:
        """The player's matches, newest first (`id` breaks ties, so offset pages are stable)."""
        statement = self._players_matches(user_id).order_by(Match.ended_at.desc(), Match.id.desc()).limit(limit).offset(offset)
        return [tuple(row) for row in await self.session.execute(statement)]

    async def get_for_player(self, match_id: UUID, user_id: UUID) -> tuple[Match, MatchParticipant, Topic | None] | None:
        row = (await self.session.execute(self._players_matches(user_id).where(Match.id == match_id))).first()
        return tuple(row) if row else None

    async def participants_of(self, match_ids: list[UUID]) -> list[tuple[MatchParticipant, User | None]]:
        statement = (
            select(MatchParticipant, User)
            .outerjoin(User, User.id == MatchParticipant.user_id)
            .where(MatchParticipant.match_id.in_(match_ids))
        )
        return [tuple(row) for row in await self.session.execute(statement)]

    async def turns_of(self, match_id: UUID) -> list[Turn]:
        return list(await self.session.scalars(select(Turn).where(Turn.match_id == match_id).order_by(Turn.index)))
