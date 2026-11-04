from typing import Literal

from pydantic import BaseModel

from app.schemas.schemas import Rating, UserPublic


class LadderRead(BaseModel):
    slug: str
    display_name: str
    kind: Literal["cloud", "byom"]


class LeaderboardEntry(BaseModel):
    rank: int
    user: UserPublic
    rating: Rating
