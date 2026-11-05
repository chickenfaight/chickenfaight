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

    async def search(self, query: str, limit: int, offset: int) -> list[User]:
        """Tagged users whose tag or username matches `query`, best first: exact tag, exact
        username, prefix, contains, then fuzzy. An exact tag wins because usernames aren't unique:
        anyone could take the name of the player being looked up."""
        tag = func.lower(User.tag)
        username = func.lower(User.username)
        needle = query.lower()
        contains = or_(tag.contains(needle, autoescape=True), username.contains(needle, autoescape=True))
        # `%>`: some part of the text is trigram-similar to the query (pg_trgm word similarity).
        fuzzy = or_(tag.op("%>")(needle), username.op("%>")(needle))
        statement = (
            select(User)
            .where(User.tag.is_not(None), or_(contains, fuzzy))
            .order_by(
                # `is_(True)`: a null username makes these NULL, which would sort first.
                (tag == needle).desc(),
                (username == needle).is_(True).desc(),
                or_(tag.startswith(needle, autoescape=True), username.startswith(needle, autoescape=True)).is_(True).desc(),
                contains.is_(True).desc(),
                func.greatest(func.word_similarity(needle, tag), func.word_similarity(needle, username)).desc(),
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
