from uuid import UUID

from typing import List

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.friend import Friend

class FriendRepository:
    def __init__(self, session: AsyncSession):
        self.session = session
    async def get_by_uuid(self, user_id: UUID) -> List[Friend]:
        statement = select(Friend).where(Friend.id == user_id)
        result = await self.session.execute(statement)
        return result.scalars.all()
    def add(self, friend: Friend) -> None:
        self.session.add(friend)