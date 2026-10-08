from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUserDependency
from app.db.session import get_session
from app.schemas import ChallengeToday
from app.schemas.schemas import ChallengeTwist, TopicRead
from app.services.challenge import CHALLENGE_POINTS, resets_at, today, topic_for, twist_for
from app.services.rewards import completed_challenge

router = APIRouter(prefix="/challenge", tags=["challenge"])
SessionDependency = Annotated[AsyncSession, Depends(get_session)]


@router.get("/today", response_model=ChallengeToday)
async def get_today(user: CurrentUserDependency, session: SessionDependency) -> ChallengeToday:
    """Today's (UTC) challenge, the same for everyone, and whether the caller has completed it."""
    day = today()
    twist = twist_for(day)
    topic = await topic_for(session, day)
    return ChallengeToday(
        day=day,
        topic=TopicRead.model_validate(topic) if topic is not None else None,
        twist=ChallengeTwist(title=twist.title, description=twist.description, max_chars=twist.max_chars),
        reward_points=CHALLENGE_POINTS,
        completed=await completed_challenge(session, user.id, day),
        resets_at=resets_at(day),
    )
