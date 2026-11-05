"""Match history (PROTOCOL.md, "Shared types"). Never holds player prompts."""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

from app.models.match import MatchStatus, Phase, Side
from app.schemas.schemas import UserPublic


class ParticipantRead(BaseModel):
    side: Side
    user: UserPublic | None  # null once the player deleted their account
    elo_before: int | None
    elo_after: int | None


class MatchSummary(BaseModel):
    id: UUID
    topic: str | None  # null if the topic was removed
    status: MatchStatus
    winner_side: Side | None
    end_reason: str
    challenge_day: date | None
    you: Side
    outcome: Literal["win", "loss", "void"]
    model: str | None  # the model the caller used; null if it wasn't recorded
    participants: list[ParticipantRead]
    ended_at: datetime


class MatchHistoryPage(BaseModel):
    items: list[MatchSummary]
    next_offset: int | None


class TurnRead(BaseModel):
    id: UUID
    index: int
    side: Side
    phase: Phase
    content: str
    truncated: bool


class MatchRead(MatchSummary):
    pro_position: str | None
    con_position: str | None
    verdict_reasoning: str | None
    turns: list[TurnRead]
