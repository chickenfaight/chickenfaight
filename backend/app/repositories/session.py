from datetime import datetime
from uuid import UUID

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.session import UserSession


class SessionRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    def add(self, user_session: UserSession) -> None:
        self.session.add(user_session)

    async def get(self, token_hash: str) -> UserSession | None:
        return await self.session.get(UserSession, token_hash)

    async def delete(self, token_hash: str) -> None:
        await self.session.execute(delete(UserSession).where(UserSession.token_hash == token_hash))

    async def delete_expired(self, user_id: UUID, now: datetime) -> None:
        await self.session.execute(
            delete(UserSession).where(UserSession.user_id == user_id, UserSession.expires_at <= now)
        )
