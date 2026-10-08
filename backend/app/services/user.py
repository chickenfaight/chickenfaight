from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.repositories.friend import FriendRepository
from app.repositories.user import UserRepository
from app.schemas import (
    GoogleIdentity,
    UserProfile,
    UserPublic,
    UsernameAvailability,
    UserSearchPage,
    LoginData,
)
from app.services.exceptions import (
    UserNotFoundError,
    UsernameAlreadySetError,
    UsernameError,
    UsernameRequiredError,
    UsernameTakenError,
    IncorrectPasswordError,
)
from app.services.usernames import validate_username


def require_username(user: User) -> None:
    if user.username is None:
        raise UsernameRequiredError()


class UserService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.users = UserRepository(session)

    async def sign_in_with_google(self, identity: GoogleIdentity) -> User:
        async with self.session.begin():
            user = await self.users.get_by_google_sub(identity.sub)

            if user is None:
                user = User(google_sub=identity.sub)
                self.users.add(user)

            # Refresh profile fields on every login because users can change their email or pfp at Google.
            # Never touch `username`: a tag is permanent once set.
            user.email = identity.email
            user.avatar_url = identity.picture

            await self.session.flush()

        return user

    async def create_account(self, identity: LoginData) -> User:
        async with self.session.begin():
            available = self.check_username_availability(identity.username)
            if not available.available:
                raise UsernameError(code=available.code, detail=available.detail)

            user = User(username=identity.username,
                        email=identity.email,
                        password_salt=identity.password_salt,
                        password_hash=identity.password_hash)
            self.users.add(user)

            await self.session.flush()

        return user

    async def sign_in_with_password(self, identity: LoginData) -> User:
        async with self.session.begin():
            user = await self.get_by_username(identity.username)

            if user.password_hash != identity.password_hash:
                raise IncorrectPasswordError()

            await self.session.flush()

        return user

    async def check_username_availability(self, username: str) -> UsernameAvailability:
        try:
            validate_username(username)
            if await self.users.get_by_username(username) is not None:
                raise UsernameTakenError()
        except UsernameError as error:
            return UsernameAvailability(available=False, code=error.code, detail=error.detail)
        return UsernameAvailability(available=True)

    async def get_by_username(self, username: str) -> User:
        user = await self.users.get_by_username(username)
        if user is None:
            raise UserNotFoundError()
        return user

    async def get_profile(self, viewer: User, username: str) -> UserProfile:
        """A player's public profile, as seen by `viewer`."""
        user = await self.get_by_username(username)
        is_friend = await FriendRepository(self.session).is_friend(viewer.id, user.id)
        return UserProfile.model_validate(user).model_copy(update={"is_friend": is_friend})

    async def search(self, query: str, limit: int, offset: int) -> UserSearchPage:
        query = query.strip()
        if not query:
            return UserSearchPage(items=[], next_offset=None)
        # Fetch one extra row to learn whether another page exists.
        found = await self.users.search_by_username(query, limit + 1, offset)
        return UserSearchPage(
            items=[UserPublic.model_validate(user) for user in found[:limit]],
            next_offset=offset + limit if len(found) > limit else None,
        )

    async def claim_username(self, user: User, username: str) -> User:
        """Set the caller's permanent tag. Raises if invalid, taken, or already set."""
        if user.username is not None:
            raise UsernameAlreadySetError()
        validate_username(username)

        # Loading the session user already began this session's transaction,
        # so finish it explicitly instead of opening one with `begin()`.
        try:
            claimed = await self.users.set_username_if_unset(user.id, username)
            await self.session.commit()
        except IntegrityError:
            await self.session.rollback()
            raise UsernameTakenError() from None

        if claimed is None:
            raise UsernameAlreadySetError()
        return claimed
