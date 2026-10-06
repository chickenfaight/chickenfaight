from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.friend import Friend
from app.repositories.friend import FriendRepository

class FriendService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.friends = FriendRepository(session)
    async def add_friend(self, self_id: UUID, friend_id: UUID) -> Friend:
        friend = Friend(id: self_id, other_id: friend_id)
        self.friends.add(friend)
        await self.session.flush()
        return friend