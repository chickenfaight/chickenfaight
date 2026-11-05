import uuid
from datetime import date, datetime
from enum import StrEnum

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def _enum(enum: type[StrEnum], name: str) -> Enum:
    # VARCHAR + CHECK (BACKEND.md), so values can change without Postgres enum migrations.
    return Enum(enum, values_callable=lambda e: [m.value for m in e], native_enum=False,
                create_constraint=True, validate_strings=True, name=name)


class MatchStatus(StrEnum):
    COMPLETED = "completed"
    FORFEITED = "forfeited"
    VOIDED = "voided"


class Side(StrEnum):
    PRO = "pro"
    CON = "con"


class Phase(StrEnum):
    OPENING = "opening"
    REBUTTAL = "rebuttal"
    CLOSING = "closing"


class Match(Base):
    """A finished match's result, recorded once by the engine (`report_game`). Votes from the planned
    schema aren't stored yet. Player prompts never are: the arena promises they stay private."""
    __tablename__ = "matches"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)  # the engine's match ID
    # Kept if the model or topic is later removed from the catalog.
    model_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("models.id", ondelete="SET NULL"), index=True)
    topic_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("topics.id", ondelete="SET NULL"), index=True)
    status: Mapped[MatchStatus] = mapped_column(_enum(MatchStatus, "match_status"))
    winner_side: Mapped[Side | None] = mapped_column(_enum(Side, "match_winner_side"))
    end_reason: Mapped[str] = mapped_column(String(32))
    verdict_reasoning: Mapped[str | None] = mapped_column(Text)
    # The UTC day of the daily challenge this match was played for; null for regular matches.
    challenge_day: Mapped[date | None] = mapped_column(Date, index=True)
    ended_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class MatchParticipant(Base):
    __tablename__ = "match_participants"
    __table_args__ = (UniqueConstraint("match_id", "user_id", name="uq_match_participants_match_id_user_id"),)

    match_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), primary_key=True)
    side: Mapped[Side] = mapped_column(_enum(Side, "participant_side"), primary_key=True)
    # Null once the player deletes their account: the opponent's history keeps the row, not the user.
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    # The model this player used, as named when the match was played. Stored per player because each
    # brings their own in BYOM, and as text so history survives renames and removals. Null if unknown.
    model_name: Mapped[str | None] = mapped_column(String(255))
    # On this match's ladder; null when Elo didn't change (forfeits and voids) or for older matches.
    elo_before: Mapped[int | None] = mapped_column(Integer)
    elo_after: Mapped[int | None] = mapped_column(Integer)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Turn(Base):
    """One side's generated text in one phase, saved with the match's result. Untrusted model
    output: shown only as plain text."""
    __tablename__ = "turns"
    __table_args__ = (UniqueConstraint("match_id", "index", name="uq_turns_match_id_index"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # The unique constraint's index covers lookups and cascades by match.
    match_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"))
    index: Mapped[int] = mapped_column(Integer)
    side: Mapped[Side] = mapped_column(_enum(Side, "turn_side"))
    phase: Mapped[Phase] = mapped_column(_enum(Phase, "turn_phase"))
    content: Mapped[str] = mapped_column(Text)
    truncated: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ChallengeCompletion(Base):
    """One row per user per UTC day they completed the daily challenge; the primary key is what
    makes the challenge's points award at most once a day, even with concurrent matches."""
    __tablename__ = "challenge_completions"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    match_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("matches.id", ondelete="SET NULL"), index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
