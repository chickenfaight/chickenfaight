from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.ladder import LadderRepository
from app.schemas.leaderboard import LadderRead, LeaderboardEntry
from app.schemas.schemas import Rating, UserPublic
from app.services.exceptions import ArenaNotFoundError

TOP_PLAYERS = 50


class LeaderboardService:
    def __init__(self, session: AsyncSession):
        self.ladders = LadderRepository(session)

    async def list_ladders(self) -> list[LadderRead]:
        return [
            LadderRead(slug=ladder.slug, display_name=display_name, kind=ladder.kind)
            for ladder, display_name in await self.ladders.list_active()
        ]

    async def standings(self, slug: str, limit: int, offset: int) -> list[LeaderboardEntry]:
        ladder = await self.ladders.get_active(slug)
        if ladder is None:
            raise ArenaNotFoundError("No active ladder has that slug.")
        if offset >= TOP_PLAYERS:
            return []

        rows = await self.ladders.ranked_players(ladder, min(limit, TOP_PLAYERS - offset), offset)
        return [
            LeaderboardEntry(
                rank=rank,
                user=UserPublic.model_validate(user),
                rating=Rating(ladder=slug, elo=rating.elo, games_played=rating.games_played,
                              wins=rating.wins, losses=rating.losses),
            )
            for rank, (user, rating) in enumerate(rows, start=offset + 1)
        ]
