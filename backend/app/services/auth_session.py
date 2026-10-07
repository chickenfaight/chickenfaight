import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.session import UserSession
from app.models.user import User
from app.repositories.session import SessionRepository

# How long a sign-in lasts; the session cookie's max-age matches it.
SESSION_LIFETIME = timedelta(days=14)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class SessionService:
    """Server-side sessions: each sign-in gets a random token that logout or expiry ends for good."""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.sessions = SessionRepository(session)

    async def start(self, user: User) -> str:
        """Create a session and return its raw token for the cookie; only the hash is stored."""
        token = secrets.token_urlsafe(32)
        now = datetime.now(timezone.utc)
        async with self.session.begin():
            await self.sessions.delete_expired(user.id, now)
            self.sessions.add(UserSession(
                token_hash=hash_token(token),
                user_id=user.id,
                expires_at=now + SESSION_LIFETIME,
            ))
        return token

    async def resolve(self, token: str) -> User | None:
        """The user a token belongs to, or None if it is unknown, expired, or its user is gone."""
        user_session = await self.sessions.get(hash_token(token))
        if user_session is None or user_session.expires_at <= datetime.now(timezone.utc):
            return None
        return await self.session.get(User, user_session.user_id)

    async def end(self, token: str) -> None:
        await self.sessions.delete(hash_token(token))
        await self.session.commit()
