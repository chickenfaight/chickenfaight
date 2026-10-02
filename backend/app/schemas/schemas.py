from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str | None
    username: str | None
    avatar_url: str | None
    elo: int

class UserPublic(BaseModel):
    """Fields anyone signed in may see. Never add email or other private data here."""
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    username: str | None
    avatar_url: str | None


class Rating(BaseModel):
    ladder: str
    elo: int
    games_played: int
    wins: int
    losses: int


class UserProfile(UserPublic):
    # Empty until the ratings table ships.
    ratings: list[Rating] = []


class UserSearchPage(BaseModel):
    items: list[UserPublic]
    next_offset: int | None


class UsernameUpdate(BaseModel):
    # Format rules are checked in the service so rejections use PROTOCOL error codes.
    username: str = Field(max_length=64)


class UsernameAvailability(BaseModel):
    available: bool
    code: str | None = None
    detail: str | None = None


class GoogleIdentity(BaseModel):
    sub: str
    email: str | None = None
    email_verified: bool = False
    name: str | None = None
    picture: str | None = None
