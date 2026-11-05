from typing import Literal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.repositories.friend import FriendRepository
from app.repositories.user import UserRepository
from app.schemas import FriendshipStatus, FriendsPage, UserPublic
from app.services.exceptions import BlockSelfError, FriendRequestNotFoundError, FriendSelfError, UserNotFoundError
from app.services.user import require_tag


class FriendService:
    """Friends and friend requests. A friendship needs both players: one asks, the other accepts.
    Every method acts on the caller's own relationships, so no one can read or edit another's.

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
        return self.page(found, limit, offset)

    async def list_requests(
        self, user: User, direction: Literal["incoming", "outgoing"], limit: int, offset: int,
    ) -> FriendsPage:
        listing = self.friends.list_incoming if direction == "incoming" else self.friends.list_outgoing
        return self.page(await listing(user.id, limit + 1, offset), limit, offset)

    async def status(self, user: User, other_id: UUID) -> FriendshipStatus:
        """How `other_id` relates to the caller."""
        if await self.friends.is_friend(user.id, other_id):
            return FriendshipStatus(is_friend=True)
        if await self.friends.request_exists(user.id, other_id):
            return FriendshipStatus(is_friend=False, friend_request="sent")
        if await self.friends.request_exists(other_id, user.id):
            return FriendshipStatus(is_friend=False, friend_request="received")
        return FriendshipStatus(is_friend=False)

    async def send_request(self, user: User, receiver_id: UUID) -> FriendshipStatus:
        """Ask to be friends. Asking a current friend changes nothing, and asking someone who
        already asked you accepts: you both want it."""
        # The receiver will be shown the sender, and players without a tag can't be displayed.
        require_tag(user)
        if receiver_id == user.id:
            raise FriendSelfError()
        # Untagged users are invisible elsewhere (search, profiles), so they can't be asked either.
        receiver = await self.users.get_by_uuid(receiver_id)
        if receiver is None or receiver.tag is None:
            raise UserNotFoundError("No player has that ID.")
        if await self.friends.lock_pair(user.id, receiver_id) < 2:
            # The other account was deleted after the lookup.
            raise UserNotFoundError("No player has that ID.")
        if await self.friends.either_blocked(user.id, receiver_id):
            # Answer as for a missing player, so a request doesn't reveal who blocked whom.
            raise UserNotFoundError("No player has that ID.")
        if await self.friends.remove_request(receiver_id, user.id):
            await self.friends.add_pair(user.id, receiver_id)
        elif not await self.friends.is_friend(user.id, receiver_id):
            await self.friends.add_request(user.id, receiver_id)
        status = await self.status(user, receiver_id)
        await self.session.commit()
        return status

    async def accept_request(self, user: User, sender_id: UUID) -> None:
        await self.friends.lock_pair(user.id, sender_id)
        if not await self.friends.remove_request(sender_id, user.id):
            # Withdrawn, already answered, or never sent.
            raise FriendRequestNotFoundError()
        await self.friends.add_pair(user.id, sender_id)
        await self.session.commit()

    async def remove_request(self, user: User, other_id: UUID) -> None:
        """Decline a request from `other_id`, or withdraw one sent to them."""
        await self.friends.lock_pair(user.id, other_id)
        await self.friends.remove_request(other_id, user.id)
        await self.friends.remove_request(user.id, other_id)
        await self.session.commit()

    async def remove_friend(self, user: User, friend_id: UUID) -> None:
        """End the friendship for both players."""
        await self.friends.lock_pair(user.id, friend_id)
        await self.friends.remove_pair(user.id, friend_id)
        await self.session.commit()

    async def block(self, user: User, blocked_id: UUID) -> None:
        """Hide the caller's profile from `blocked_id`. Ends any friendship and pending requests
        between them, in both directions, and stops either from asking again until unblocked."""
        if blocked_id == user.id:
            raise BlockSelfError()
        # Like friend requests, only players visible elsewhere (tagged) can be blocked.
        blocked = await self.users.get_by_uuid(blocked_id)
        if blocked is None or blocked.tag is None:
            raise UserNotFoundError("No player has that ID.")
        if await self.friends.lock_pair(user.id, blocked_id) < 2:
            # The other account was deleted after the lookup.
            raise UserNotFoundError("No player has that ID.")
        await self.friends.add_block(user.id, blocked_id)
        await self.friends.remove_pair(user.id, blocked_id)
        await self.friends.remove_request(user.id, blocked_id)
        await self.friends.remove_request(blocked_id, user.id)
        await self.session.commit()

    async def unblock(self, user: User, blocked_id: UUID) -> None:
        """Lift the caller's own block; a block by the other player stays."""
        await self.friends.lock_pair(user.id, blocked_id)
        await self.friends.remove_block(user.id, blocked_id)
        await self.session.commit()

    @staticmethod
    def page(found: list[User], limit: int, offset: int) -> FriendsPage:
        return FriendsPage(
            items=[UserPublic.model_validate(friend) for friend in found[:limit]],
            next_offset=offset + limit if len(found) > limit else None,
        )
