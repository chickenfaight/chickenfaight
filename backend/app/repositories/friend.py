from uuid import UUID

from sqlalchemy import delete, exists, func, or_, and_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.friend import FriendRequest, Friendship
from app.models.block import UserBlock
from app.models.user import User


class FriendRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def lock_pair(self, first: UUID, second: UUID) -> int:
        """Lock both players' rows until the transaction ends, always in the same order, so two
        changes to one pair (such as requesting each other at once) run one after the other.
        Returns how many of them exist. `key_share` leaves other tables' foreign keys unblocked."""
        statement = (
            select(User.id)
            .where(User.id.in_((first, second)))
            .order_by(User.id)
            .with_for_update(key_share=True)
        )
        return len((await self.session.execute(statement)).all())

    async def add_pair(self, first: UUID, second: UUID) -> None:
        """Make two players friends; a friendship is stored once each way."""
        statement = (
            insert(Friendship)
            .values([
                {"user_id": first, "friend_id": second},
                {"user_id": second, "friend_id": first},
            ])
            .on_conflict_do_nothing(index_elements=[Friendship.user_id, Friendship.friend_id])
        )
        await self.session.execute(statement)

    async def remove_pair(self, first: UUID, second: UUID) -> None:
        statement = delete(Friendship).where(or_(
            and_(Friendship.user_id == first, Friendship.friend_id == second),
            and_(Friendship.user_id == second, Friendship.friend_id == first),
        ))
        await self.session.execute(statement)

    # Checks if blocked_id is blocked by user_id. For inverse, just switch args.
    async def is_blocked(self, blocked_id: UUID, user_id: UUID) -> bool:
        statement = select(exists().where(
            UserBlock.user_id == user_id,
            UserBlock.blocked_id == blocked_id,
        ))
        return bool(await self.session.scalar(statement))

    async def is_friend(self, user_id: UUID, friend_id: UUID) -> bool:
        statement = select(exists().where(
            Friendship.user_id == user_id,
            Friendship.friend_id == friend_id,
        ))
        return bool(await self.session.scalar(statement))

    async def list_friends(self, user_id: UUID, limit: int, offset: int) -> list[User]:
        """`user_id`'s friends, ordered by tag ignoring case (`id` breaks ties)."""
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

    async def add_request(self, sender_id: UUID, receiver_id: UUID) -> None:
        """Record the request; asking again changes nothing."""
        statement = (
            insert(FriendRequest)
            .values(sender_id=sender_id, receiver_id=receiver_id)
            .on_conflict_do_nothing(index_elements=[FriendRequest.sender_id, FriendRequest.receiver_id])
        )
        await self.session.execute(statement)

    async def request_exists(self, sender_id: UUID, receiver_id: UUID) -> bool:
        statement = select(exists().where(
            FriendRequest.sender_id == sender_id,
            FriendRequest.receiver_id == receiver_id,
        ))
        return bool(await self.session.scalar(statement))

    async def remove_request(self, sender_id: UUID, receiver_id: UUID) -> bool:
        """Delete one request; returns whether it existed."""
        statement = (
            delete(FriendRequest)
            .where(FriendRequest.sender_id == sender_id, FriendRequest.receiver_id == receiver_id)
            .returning(FriendRequest.sender_id)
        )
        return (await self.session.execute(statement)).first() is not None

    async def list_incoming(self, user_id: UUID, limit: int, offset: int) -> list[User]:
        """Players asking to be friends with `user_id`, newest first (`id` breaks ties)."""
        statement = (
            select(User)
            .join(FriendRequest, FriendRequest.sender_id == User.id)
            .where(FriendRequest.receiver_id == user_id)
            .order_by(FriendRequest.created_at.desc(), User.id)
            .limit(limit)
            .offset(offset)
        )
        return list((await self.session.execute(statement)).scalars())

    async def list_outgoing(self, user_id: UUID, limit: int, offset: int) -> list[User]:
        """Players `user_id` has asked, newest first (`id` breaks ties)."""
        statement = (
            select(User)
            .join(FriendRequest, FriendRequest.receiver_id == User.id)
            .where(FriendRequest.sender_id == user_id)
            .order_by(FriendRequest.created_at.desc(), User.id)
            .limit(limit)
            .offset(offset)
        )
        return list((await self.session.execute(statement)).scalars())
