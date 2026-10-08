from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Model
from app.repositories.arena import ArenaRepository
from app.schemas.schemas import ArenaRead
from app.services.exceptions import ArenaNotFoundError


class ArenaService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.arenas = ArenaRepository(session)

    async def list_active(self) -> list[ArenaRead]:
        arenas: list[Model] = await self.arenas.get_active_arenas()
        return [ArenaRead.model_validate(arena) for arena in arenas]

    async def require_active(self, model_id: UUID) -> None:
        await self.get_active(model_id)

    async def get_active(self, model_id: UUID) -> Model:
        model = await self.arenas.get_active_arena(model_id)
        if model is None:
            raise ArenaNotFoundError()
        return model
