from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.rate_limit import rate_limit
from app.auth.dependencies import CurrentUserDependency
from app.db.session import get_session
from app.schemas import FriendsPage
from app.services.friend import FriendService

router = APIRouter(prefix="/friends", tags=["friends"])
SessionDependency = Annotated[AsyncSession, Depends(get_session)]

# Adding and removing share one budget.
write_limit = rate_limit(burst=10, per_minute=20)


@router.get("", response_model=FriendsPage, dependencies=[rate_limit(burst=20, per_minute=60)])
async def list_friends(
    user: CurrentUserDependency,
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> FriendsPage:
    return await FriendService(session).list_friends(user, limit, offset)


@router.put("/{user_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[write_limit])
async def add_friend(user_id: UUID, user: CurrentUserDependency, session: SessionDependency) -> None:
    await FriendService(session).add_friend(user, user_id)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[write_limit])
async def remove_friend(user_id: UUID, user: CurrentUserDependency, session: SessionDependency) -> None:
    await FriendService(session).remove_friend(user, user_id)
