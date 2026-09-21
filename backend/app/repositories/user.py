from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User


class UserRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_by_google_sub(self, google_sub: str) -> User | None:
        statement = select(User).where(User.google_sub == google_sub)
        result = await self.session.execute(statement)
        return result.scalar_one_or_none()

    def add(self, user: User) -> None:
        self.session.add(user)
