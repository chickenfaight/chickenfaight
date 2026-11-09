from datetime import date, datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, computed_field, model_validator

from app.auth.admins import is_admin_tag


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str | None
    tag: str | None
    username: str | None
    avatar_url: str | None

    @computed_field
    @property
    def is_admin(self) -> bool:
        """Whether this user's tag is in `ADMIN_TAGS`, so clients can show admin pages."""
        return is_admin_tag(self.tag)


class ArenaStats(BaseModel):
    points: int
    debates_played: int
    wins: int
    win_rate: float | None
    recent_form: list[Literal["W", "L"]]


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


class FriendshipStatus(BaseModel):
    """How a player relates to the caller."""
    is_friend: bool = False
    # A pending request between them: "sent" by the caller, or "received" from this player.
    friend_request: Literal["sent", "received"] | None = None


class UserProfile(UserPublic):
    ratings: list[Rating] = []
    # Whether this player has blocked the caller; then only `id`, `tag`, and `is_blocked` are real.
    read_blocked: bool = False
    # Whether this player and the caller are friends, and any pending request between them.
    is_friend: bool = False
    friend_request: Literal["sent", "received"] | None = None
    # Whether the caller has blocked this player
    is_blocked: bool = False
    # Daily-play rewards; `streak` already lapses to 0 after 48 hours without a finished match.
    points: int = 0
    streak: int = 0
    rank: int | None = None  # by points among tagged players


class UserSearchPage(BaseModel):
    items: list[UserPublic]
    next_offset: int | None


class TagUpdate(BaseModel):
    # Format rules are checked in the service so rejections use PROTOCOL error codes.
    tag: str = Field(max_length=64)


class AccountUpdate(BaseModel):
    # Length and content rules are checked in the service so rejections use PROTOCOL error codes.
    username: str | None = Field(default=None, max_length=64)
    email: EmailStr | None = None

    @model_validator(mode="after")
    def validate_update(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("Supply a username or email.")
        if "username" in self.model_fields_set and self.username is None:
            raise ValueError("Username cannot be null.")
        return self


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


class TipsMessage(BaseModel):
    role: Literal["user", "assistant"]  # never "system": only the server writes the system prompt
    content: str = Field(min_length=1, max_length=2000)


class TipsChatRequest(BaseModel):
    model_id: UUID
    messages: list[TipsMessage] = Field(min_length=1, max_length=20)


class TipsTip(BaseModel):
    tips: list[str]


class QueueRequest(BaseModel):
    model_id: UUID | None
    daily: bool = False  # join today's daily-challenge queue for this model
    bilc_id: UUID | None = None  # required for, and only for, the BYOM arena


class ChallengeTwist(BaseModel):
    title: str
    description: str
    max_chars: int | None


class ChallengeToday(BaseModel):
    day: date
    topic: "TopicRead | None"
    twist: ChallengeTwist
    reward_points: int
    completed: bool
    resets_at: datetime
