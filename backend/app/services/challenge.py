"""The daily challenge (US14): one topic and one twist per UTC day, the same for everyone."""

import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Topic

CHALLENGE_POINTS = 50


@dataclass(frozen=True)
class Twist:
    title: str
    description: str
    max_chars: int | None = None
    banned_word: str | None = None
    required_word: str | None = None


# Rotates by day. Every twist is checked by the engine when a prompt is submitted.
TWISTS = (
    Twist("Short and sharp", "Your strategy must be 150 characters or fewer.", max_chars=150),
    Twist("No excuses", "Your strategy can't use the word \"because\".", banned_word="because"),
    Twist("Tweet-sized", "Your strategy must be 280 characters or fewer.", max_chars=280),
    Twist("Fowl play", "Your strategy must include the word \"chicken\".", required_word="chicken"),
    Twist("Haiku hero", "Your strategy must be 100 characters or fewer.", max_chars=100),
    Twist("Very banned", "Your strategy can't use the word \"very\".", banned_word="very"),
)


def today() -> date:
    return datetime.now(UTC).date()


def resets_at(day: date) -> datetime:
    return datetime.combine(day + timedelta(days=1), time.min, tzinfo=UTC)


def twist_for(day: date) -> Twist:
    return TWISTS[day.toordinal() % len(TWISTS)]


async def topic_for(session: AsyncSession, day: date) -> Topic | None:
    """Today's topic: a stable pick from the active topics, so every player gets the same one."""
    topics = (await session.scalars(
        select(Topic).where(Topic.is_active.is_(True)).order_by(Topic.created_at, Topic.id)
    )).all()
    return topics[day.toordinal() % len(topics)] if topics else None


def _has_word(text: str, word: str) -> bool:
    return re.search(rf"\b{re.escape(word)}\b", text, re.IGNORECASE) is not None


def check_prompt(twist: Twist, prompt: str) -> str | None:
    """Why `prompt` breaks today's twist, or None if it follows it."""
    if twist.max_chars is not None and len(prompt) > twist.max_chars:
        return f"Today's challenge allows {twist.max_chars} characters; yours has {len(prompt)}."
    if twist.banned_word and _has_word(prompt, twist.banned_word):
        return f"Today's challenge bans the word \"{twist.banned_word}\"."
    if twist.required_word and not _has_word(prompt, twist.required_word):
        return f"Today's challenge requires the word \"{twist.required_word}\"."
    return None
