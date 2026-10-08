from uuid import UUID

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User


class UserRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_by_google_sub(self, google_sub: str) -> User | None:
        statement = select(User).where(User.google_sub == google_sub)
        result = await self.session.execute(statement)
        return result.scalar_one_or_none()

    async def get_by_tag(self, tag: str) -> User | None:
        statement = select(User).where(func.lower(User.tag) == tag.lower())
        result = await self.session.execute(statement)
        return result.scalar_one_or_none()
        
    async def get_by_uuid(self, user_id: UUID) -> User | None:
        statement = select(User).where(User.id == user_id)
        result = await self.session.execute(statement)
        return result.scalar_one_or_none()

    async def search_by_tag(self, query: str, limit: int, offset: int) -> list[User]:
        """Tagged users matching `query`, best first: exact, prefix, contains, then fuzzy."""
        tag = func.lower(User.tag)
        needle = query.lower()
        exact = tag == needle
        prefix = tag.startswith(needle, autoescape=True)
        contains = tag.contains(needle, autoescape=True)
        # `%>`: some part of the tag is trigram-similar to the query (pg_trgm word similarity).
        fuzzy = tag.op("%>")(needle)
        statement = (
            select(User)
            .where(User.tag.is_not(None), or_(contains, fuzzy))
            .order_by(
                exact.desc(),
                prefix.desc(),
                contains.desc(),
                func.word_similarity(needle, tag).desc(),
                func.length(User.tag),
                tag,
                User.id,
            )
            .limit(limit)
            .offset(offset)
        )
        result = await self.session.execute(statement)
        return list(result.scalars())

    async def set_tag_if_unset(self, user_id: UUID, tag: str) -> User | None:
        """Atomically set a tag only if none exists; returns None if one already did."""
        statement = (
            update(User)
            .where(User.id == user_id, User.tag.is_(None))
            .values(tag=tag)
            .returning(User)
        )
        result = await self.session.execute(statement)
        return result.scalar_one_or_none()

    def add(self, user: User) -> None:
        self.session.add(user)
