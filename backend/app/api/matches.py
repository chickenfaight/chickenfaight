from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.rate_limit import rate_limit
from app.auth.dependencies import CurrentUserDependency
from app.db.session import get_session
from app.schemas import MatchHistoryPage, MatchRead
from app.services.match_history import MatchHistoryService

router = APIRouter(tags=["matches"])
SessionDependency = Annotated[AsyncSession, Depends(get_session)]


@router.get("/users/{user_id}/matches", response_model=MatchHistoryPage, dependencies=[rate_limit(burst=20, per_minute=60)])
async def list_matches(
    user_id: UUID,
    user: CurrentUserDependency,
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> MatchHistoryPage:
    return await MatchHistoryService(session).list_matches(user, user_id, limit, offset)


@router.get("/matches/{match_id}", response_model=MatchRead, dependencies=[rate_limit(burst=20, per_minute=60)])
async def get_match(match_id: UUID, user: CurrentUserDependency, session: SessionDependency) -> MatchRead:
    return await MatchHistoryService(session).get_match(user, match_id)
