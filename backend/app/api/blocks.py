from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.friends import write_limit
from app.auth.dependencies import CurrentUserDependency
from app.db.session import get_session
from app.services.friend import FriendService

router = APIRouter(prefix="/block", tags=["friends"])
SessionDependency = Annotated[AsyncSession, Depends(get_session)]


# Blocking changes friendships too, so it shares the friends routes' write budget.
@router.put("/{user_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[write_limit])
async def block(user_id: UUID, user: CurrentUserDependency, session: SessionDependency) -> None:
    await FriendService(session).block(user, user_id)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[write_limit])
async def unblock(user_id: UUID, user: CurrentUserDependency, session: SessionDependency) -> None:
    await FriendService(session).unblock(user, user_id)
