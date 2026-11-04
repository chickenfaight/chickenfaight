from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
import uuid

from app.models import Rating
from app.models.ladder_rating import DEFAULT_ELO
from app.db.base import Base

class RatingRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_rating(self, user_id: uuid.UUID, ladder_id: uuid.UUID) -> Optional[Rating]:
        stmt = select(Rating).where(
            Rating.user_id == user_id,
            Rating.ladder_id == ladder_id
        )
        res = await self.session.execute(stmt)
        return res.scalar_one_or_none()

    async def get_or_create_rating(self, user_id: uuid.UUID, ladder_id: uuid.UUID) -> Rating:
        rating = await self.get_rating(user_id, ladder_id)
        if rating:
            return rating
        
        new_rating = Rating(
            user_id=user_id,
            ladder_id=ladder_id,
            elo=DEFAULT_ELO,
            games_played=0,
            wins=0,
            losses=0
        )
        try:
            async with self.session.begin_nested():
                self.session.add(new_rating)
                await self.session.flush()
            return new_rating
        except IntegrityError:
            return await self.get_rating(user_id, ladder_id)
            
    def get_all_ratings_for_user(self, user_id: uuid.UUID) -> list[Rating]:
        stmt = select(Rating).where(Rating.user_id == user_id)
        return list(self.session.execute(stmt).scalars().all())
