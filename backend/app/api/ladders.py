from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.rate_limit import rate_limit
from app.auth.dependencies import CurrentUserDependency
from app.db.session import get_session
from app.schemas.leaderboard import LadderRead, LeaderboardEntry
from app.services.leaderboard import TOP_PLAYERS, LeaderboardService

router = APIRouter(prefix="/ladders", tags=["ladders"])
SessionDependency = Annotated[AsyncSession, Depends(get_session)]


@router.get("")
async def get_ladders(_user: CurrentUserDependency, session: SessionDependency) -> list[LadderRead]:
    return await LeaderboardService(session).list_ladders()


@router.get("/{slug}/leaderboard", dependencies=[rate_limit(burst=20, per_minute=60)])
async def get_leaderboard(
    slug: Annotated[str, Path(max_length=255)],
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=TOP_PLAYERS)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[LeaderboardEntry]:
    return await LeaderboardService(session).standings(slug, limit, offset)
