from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.repositories.friend import FriendRepository
from app.repositories.user import UserRepository
from app.schemas import (
    GoogleIdentity,
    UserProfile,
    UserPublic,
    TagAvailability,
    UserSearchPage,
    LoginData,
    SignupData,
)
from app.services.exceptions import (
    UserNotFoundError,
    TagAlreadySetError,
    TagError,
    TagRequiredError,
    TagTakenError,
    InvalidCredentialsError,
)
from app.auth.passwords import hash_password, verify_password
from app.services.tags import validate_tag
from app.services.usernames import validate_username


def require_tag(user: User) -> None:
    if user.tag is None:
        raise TagRequiredError()


class UserService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.users = UserRepository(session)

    async def sign_in_with_google(self, identity: GoogleIdentity) -> User:
        async with self.session.begin():
            user = await self.users.get_by_google_sub(identity.sub)

            if user is None:
                # Start with the Google name as the username; it's changeable, so only on creation.
                name = (identity.name or "").strip()[:32] or None
                user = User(google_sub=identity.sub, username=name)
                self.users.add(user)

            # Refresh profile fields on every login because users can change their email or pfp at Google.
            # Never touch `tag`: a tag is permanent once set.
            user.email = identity.email
            user.avatar_url = identity.picture

            await self.session.flush()

        return user

    async def create_account(self, data: SignupData) -> User:
        """A password account with its tag set at creation; tag rules match `claim_tag`."""
        validate_tag(data.tag)
        username = validate_username(data.username)
        salt, password_hash = hash_password(data.password)
        try:
            async with self.session.begin():
                if await self.users.get_by_tag(data.tag) is not None:
                    raise TagTakenError()
                user = User(tag=data.tag, username=username, email=data.email,
                            password_salt=salt, password_hash=password_hash)
                self.users.add(user)
                await self.session.flush()
        except IntegrityError:
            # Another signup took the tag between the check and the insert.
            raise TagTakenError() from None
        return user

    async def sign_in_with_password(self, data: LoginData) -> User:
        async with self.session.begin():
            user = await self.users.get_by_tag(data.tag)
        if user is None:
            verify_password(data.password, None, None)  # same work as a real check
            raise InvalidCredentialsError()
        if not verify_password(data.password, user.password_salt, user.password_hash):
            raise InvalidCredentialsError()
        return user

    async def check_tag_availability(self, tag: str) -> TagAvailability:
        try:
            validate_tag(tag)
            if await self.users.get_by_tag(tag) is not None:
                raise TagTakenError()
        except TagError as error:
            return TagAvailability(available=False, code=error.code, detail=error.detail)
        return TagAvailability(available=True)

    async def get_by_tag(self, tag: str) -> User:
        user = await self.users.get_by_tag(tag)
        if user is None:
            raise UserNotFoundError()
        return user

    async def get_profile(self, viewer: User, tag: str) -> UserProfile:
        """A player's public profile, as seen by `viewer`."""
        user = await self.get_by_tag(tag)
        is_friend = await FriendRepository(self.session).is_friend(viewer.id, user.id)
        return UserProfile.model_validate(user).model_copy(update={"is_friend": is_friend})

    async def search(self, query: str, limit: int, offset: int) -> UserSearchPage:
        query = query.strip()
        if not query:
            return UserSearchPage(items=[], next_offset=None)
        # Fetch one extra row to learn whether another page exists.
        found = await self.users.search_by_tag(query, limit + 1, offset)
        return UserSearchPage(
            items=[UserPublic.model_validate(user) for user in found[:limit]],
            next_offset=offset + limit if len(found) > limit else None,
        )

    async def change_username(self, user: User, username: str) -> User:
        """Change the caller's display name; unlike the tag, any number of times."""
        user.username = validate_username(username)
        # Loading the session user already began this session's transaction.
        await self.session.commit()
        return user

    async def claim_tag(self, user: User, tag: str) -> User:
        """Set the caller's permanent tag. Raises if invalid, taken, or already set."""
        if user.tag is not None:
            raise TagAlreadySetError()
        validate_tag(tag)

        # Loading the session user already began this session's transaction,
        # so finish it explicitly instead of opening one with `begin()`.
        try:
            claimed = await self.users.set_tag_if_unset(user.id, tag)
            await self.session.commit()
        except IntegrityError:
            await self.session.rollback()
            raise TagTakenError() from None

        if claimed is None:
            raise TagAlreadySetError()
        return claimed
