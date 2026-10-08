from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.repositories.friend import FriendRepository
from app.repositories.user import UserRepository
from app.schemas import FriendsPage, UserPublic
from app.services.exceptions import FriendSelfError, UserNotFoundError


class FriendService:
    """Friends lists. Every method acts on the caller's own list, so no one can read or edit another's.

    These run on `CurrentUserDependency` routes, where loading the user already began the
    session's transaction, so writes finish it with `commit()` instead of `begin()`.
    """

    def __init__(self, session: AsyncSession):
        self.session = session
        self.friends = FriendRepository(session)
        self.users = UserRepository(session)

    async def list_friends(self, user: User, limit: int, offset: int) -> FriendsPage:
        # Fetch one extra row to learn whether another page exists.
        found = await self.friends.list_friends(user.id, limit + 1, offset)
        return FriendsPage(
            items=[UserPublic.model_validate(friend) for friend in found[:limit]],
            next_offset=offset + limit if len(found) > limit else None,
        )

    async def add_friend(self, user: User, friend_id: UUID) -> None:
        if friend_id == user.id:
            raise FriendSelfError()
        # Untagged users are invisible elsewhere (search, profiles), so they can't be added either.
        friend = await self.users.get_by_uuid(friend_id)
        if friend is None or friend.tag is None:
            raise UserNotFoundError("No player has that ID.")
        try:
            await self.friends.add(user.id, friend_id)
            await self.session.commit()
        except IntegrityError:
            # The other account was deleted after the lookup.
            await self.session.rollback()
            raise UserNotFoundError("No player has that ID.") from None

    async def remove_friend(self, user: User, friend_id: UUID) -> None:
        await self.friends.remove(user.id, friend_id)
        await self.session.commit()
