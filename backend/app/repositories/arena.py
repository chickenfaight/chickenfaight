from uuid import UUID

from sqlalchemy import String, cast, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Ladder, Model, Provider


class ArenaRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_queueable_model_ids(self) -> list[UUID]:
        statement = select(Model.id).join(
            Ladder, Ladder.slug == "ladder-" + cast(Model.id, String),
        ).where(Model.is_active.is_(True), Ladder.is_active.is_(True), Ladder.kind == "cloud")
        return list(await self.session.scalars(statement))

    async def get_active_arenas(self) -> list[tuple[Model, str]]:
        statement = select(Model, Provider.slug).join(Provider, Model.provider_id == Provider.id).where(Model.is_active.is_(True))
        res = await self.session.execute(statement)
        return [(model, provider_slug) for model, provider_slug in res.all()]

    async def get_active_arena(self, model_id: UUID) -> Model | None:
        statement = select(Model).where(Model.id == model_id, Model.is_active.is_(True))
        res = await self.session.execute(statement)
        return res.scalar_one_or_none()
