from uuid import UUID

from sqlalchemy import delete, exists, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.friend import Friendship
from app.models.user import User


class FriendRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def add(self, user_id: UUID, friend_id: UUID) -> None:
        """Record the friendship; adding an existing friend changes nothing."""
        statement = (
            insert(Friendship)
            .values(user_id=user_id, friend_id=friend_id)
            .on_conflict_do_nothing(index_elements=[Friendship.user_id, Friendship.friend_id])
        )
        await self.session.execute(statement)

    async def remove(self, user_id: UUID, friend_id: UUID) -> None:
        statement = delete(Friendship).where(
            Friendship.user_id == user_id,
            Friendship.friend_id == friend_id,
        )
        await self.session.execute(statement)

    async def is_friend(self, user_id: UUID, friend_id: UUID) -> bool:
        statement = select(exists().where(
            Friendship.user_id == user_id,
            Friendship.friend_id == friend_id,
        ))
        return bool(await self.session.scalar(statement))

    async def list_friends(self, user_id: UUID, limit: int, offset: int) -> list[User]:
        """Users that `user_id` has added, ordered by tag ignoring case (`id` breaks ties)."""
        statement = (
            select(User)
            .join(Friendship, Friendship.friend_id == User.id)
            .where(Friendship.user_id == user_id)
            .order_by(func.lower(User.tag), User.id)
            .limit(limit)
            .offset(offset)
        )
        result = await self.session.execute(statement)
        return list(result.scalars())
