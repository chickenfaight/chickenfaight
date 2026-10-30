from typing import Optional
import uuid
from sqlalchemy.orm import Session
from app.repositories.rating import RatingRepository
from app.models import Rating

class RatingService:
    def __init__(self, session: Session):
        self.session = session
        self.repository = RatingRepository(self.session)

    def get_rating(self, user_id: uuid.UUID, ladder_id: uuid.UUID) -> Optional[Rating]:
        return self.repository.get_rating(user_id, ladder_id)

    def update_rating(self, user_id: uuid.UUID, ladder_id: uuid.UUID, new_elo: int) -> Rating:
        with self.session.begin():
            return self.repository.update_rating(user_id, ladder_id, new_elo)

    def calculate_and_update_elo(self, user_id: uuid.UUID, ladder_id: uuid.UUID, opponent_elo: int, result: str) -> Rating:
        """
        Calculates and updates Elo.
        result: 'win' (1.0), 'loss' (0.0), or 'draw' (0.5)
        """
        with self.session.begin():
            user_rating = self.repository.get_or_create_rating(user_id, ladder_id)
            
            expected_score = 1 / (1 + 10 ** ((opponent_elo - user_rating.elo) / 400))
            actual_score = 1.0 if result == "win" else (0.5 if result == "draw" else 0.0)
            
            k = 32
            new_elo = round(user_rating.elo + k * (actual_score - expected_score))
            
            user_rating.elo = new_elo
            user_rating.games_played += 1
            if result == "win":
                user_rating.wins += 1
            elif result == "loss":
                user_rating.losses += 1
            
            return user_rating
