from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str | None
    username: str | None
    avatar_url: str | None
    elo: int

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

class FriendsRead(BaseModel):
    id: UUID
    friend_ids: List[UUID]
    
class FriendAdd(BaseModel):
    id: UUID
    other_id: UUID