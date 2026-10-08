from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Model


class ArenaRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_active_arenas(self) -> list[Model]:
        statement = select(Model).where(Model.is_active.is_(True))
        res = await self.session.execute(statement)
        return list(res.scalars().all())
