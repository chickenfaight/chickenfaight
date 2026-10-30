from typing import Optional
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
import uuid

from app.models import Rating
from app.db.base import Base

class RatingRepository:
    def __init__(self, session: Session):
        self.session = session

    def get_rating(self, user_id: uuid.UUID, ladder_id: uuid.UUID) -> Optional[Rating]:
        stmt = select(Rating).where(
            Rating.user_id == user_id,
            Rating.ladder_id == ladder_id
        )
        return self.session.execute(stmt).scalar_one_or_none()

    def get_or_create_rating(self, user_id: uuid.UUID, ladder_id: uuid.UUID) -> Rating:
        rating = self.get_rating(user_id, ladder_id)
        if rating:
            return rating
        
        new_rating = Rating(
            user_id=user_id,
            ladder_id=ladder_id,
            elo=1000,
            games_played=0,
            wins=0,
            losses=0
        )
        try:
            self.session.add(new_rating)
            self.session.flush()
            return new_rating
        except IntegrityError:
            self.session.rollback()
            return self.get_rating(user_id, ladder_id)!
            
    def get_all_ratings_for_user(self, user_id: uuid.UUID) -> list[Rating]:
        stmt = select(Rating).where(Rating.user_id == user_id)
        return list(self.session.execute(stmt).scalars().all())
