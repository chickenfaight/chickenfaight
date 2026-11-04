from collections.abc import Sequence

from sqlalchemy import Row, and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Ladder, Model, Rating, User


class LadderRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    @staticmethod
    def _active():
        # The canonical slug links the ladder to a model UUID, even if different
        # providers use the same API model ID. BYOM has no models row.
        return (
            select(Ladder, func.coalesce(Model.display_name, Ladder.display_name))
            .outerjoin(Model, Ladder.slug == func.concat("ladder-", Model.id))
            .where(
                Ladder.is_active.is_(True),
                or_(
                    and_(Ladder.kind == "cloud", Model.is_active.is_(True)),
                    and_(Ladder.kind == "byom", Ladder.slug == "byom-arena"),
                ),
            )
        )

    async def list_active(self) -> Sequence[Row[tuple[Ladder, str]]]:
        statement = self._active().order_by(
            case((Ladder.kind == "byom", 1), else_=0),
            func.lower(Model.display_name),
            Ladder.slug,
        )
        return (await self.session.execute(statement)).all()

    async def get_active(self, slug: str) -> Ladder | None:
        return await self.session.scalar(self._active().where(Ladder.slug == slug))

    async def ranked_players(self, ladder: Ladder, limit: int, offset: int) -> Sequence[Row[tuple[User, Rating]]]:
        statement = (
            select(User, Rating)
            .join(Rating, Rating.user_id == User.id)
            .where(Rating.ladder_id == ladder.id, Rating.games_played > 0, User.tag.is_not(None))
            .order_by(Rating.elo.desc(), func.lower(User.tag))
            .limit(limit)
            .offset(offset)
        )
        return (await self.session.execute(statement)).all()
