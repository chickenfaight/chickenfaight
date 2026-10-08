from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str | None
    tag: str | None
    username: str | None
    avatar_url: str | None
    elo: int


class UserPublic(BaseModel):
    """Fields anyone signed in may see. Never add email or other private data here."""
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tag: str | None
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
    # Whether the caller has added this player as a friend.
    is_friend: bool = False


class UserSearchPage(BaseModel):
    items: list[UserPublic]
    next_offset: int | None


class TagUpdate(BaseModel):
    # Format rules are checked in the service so rejections use PROTOCOL error codes.
    tag: str = Field(max_length=64)


class UsernameUpdate(BaseModel):
    # Length and content rules are checked in the service so rejections use PROTOCOL error codes.
    username: str = Field(max_length=64)


class TagAvailability(BaseModel):
    available: bool
    code: str | None = None
    detail: str | None = None


class GoogleIdentity(BaseModel):
    sub: str
    email: str | None = None
    email_verified: bool = False
    name: str | None = None
    picture: str | None = None


class SignupData(BaseModel):
    tag: str = Field(max_length=64)  # tag and username rules are checked by the service
    username: str = Field(max_length=64)
    email: str | None = Field(default=None, max_length=320)
    password: str = Field(min_length=8, max_length=128)


class LoginData(BaseModel):
    tag: str = Field(max_length=64)
    password: str = Field(min_length=1, max_length=128)


class TopicRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    category: str
    topic: str
    pro_position: str
    con_position: str


class PromptSubmission(BaseModel):
    prompt: str = Field(min_length=1, max_length=2000)


class Verdict(BaseModel):
    winner: Literal["pro", "con"]
    reason: str


class FriendsPage(BaseModel):
    items: list[UserPublic]
    next_offset: int | None


class ArenaRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    display_name: str
    kind: Literal["provided", "byom"] = "provided" # TODO default to provided before BYOM is implemented


class QueueRequest(BaseModel):
    model_id: UUID
