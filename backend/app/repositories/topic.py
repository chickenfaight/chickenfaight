from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.topic import Topic


class TopicRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_by_id(self, topic_id: UUID) -> Topic | None:
        return await self.session.get(Topic, topic_id)

    async def get_random_active(self) -> Topic | None:
        statement = (
            select(Topic)
            .where(Topic.is_active.is_(True))
            .order_by(func.random())
            .limit(1)
        )
        result = await self.session.execute(statement)
        return result.scalar_one_or_none()

    async def get_by_content(
        self, topic: str, pro_position: str, con_position: str, category: str
    ) -> Topic | None:
        statement = select(Topic).where(
            Topic.category == category,
            Topic.topic == topic,
            Topic.pro_position == pro_position,
            Topic.con_position == con_position,
        ).limit(1)
        result = await self.session.execute(statement)
        return result.scalar_one_or_none()

    def add(self, topic: Topic) -> None:
        self.session.add(topic)
