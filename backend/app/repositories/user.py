from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User


class UserRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_by_google_sub(self, google_sub: str) -> User | None:
        statement = select(User).where(User.google_sub == google_sub)
        result = await self.session.execute(statement)
        return result.scalar_one_or_none()

    async def get_by_username(self, username: str) -> User | None:
        statement = select(User).where(func.lower(User.username) == username.lower())
        result = await self.session.execute(statement)
        return result.scalar_one_or_none()
        
    async def get_by_uuid(self, user_id: UUID) -> User | None:
        statement = select(User).where(User.id == user_id)
        result = await self.session.execute(statement)
        return result.scalar_one_or_none()

    async def set_username_if_unset(self, user_id: UUID, username: str) -> User | None:
        """Atomically set a tag only if none exists; returns None if one already did."""
        statement = (
            update(User)
            .where(User.id == user_id, User.username.is_(None))
            .values(username=username)
            .returning(User)
        )
        result = await self.session.execute(statement)
        return result.scalar_one_or_none()

    def add(self, user: User) -> None:
        self.session.add(user)
