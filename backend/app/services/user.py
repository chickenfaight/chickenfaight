from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.repositories.user import UserRepository
from app.schemas import GoogleIdentity, UsernameAvailability
from app.services.exceptions import (
    UsernameAlreadySetError,
    UsernameError,
    UsernameRequiredError,
    UsernameTakenError,
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

    async def check_username_availability(self, username: str) -> UsernameAvailability:
        try:
            validate_username(username)
            if await self.users.get_by_username(username) is not None:
                raise UsernameTakenError()
        except UsernameError as error:
            return UsernameAvailability(available=False, code=error.code, detail=error.detail)
        return UsernameAvailability(available=True)

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
