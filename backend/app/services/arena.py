from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Model
from app.repositories.arena import ArenaRepository
from app.schemas.schemas import ArenaRead


class ArenaService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.arenas = ArenaRepository(session)

    async def list_active(self) -> list[ArenaRead]:
        arenas: list[Model] = await self.arenas.get_active_arenas()
        return [ArenaRead.model_validate(arena) for arena in arenas]
