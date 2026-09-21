from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.repositories.user import UserRepository
from app.schemas import GoogleIdentity


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
            user.email = identity.email
            user.avatar_url = identity.picture

            await self.session.flush()

        return user
