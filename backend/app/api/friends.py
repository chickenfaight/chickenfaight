from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUserDependency
from app.db.session import get_session
from app.schemas import FriendsRead, FriendAdd
from app.services.friend import FriendService

router = APIRouter(prefix="/api/v1/friends", tags=["friends"])
SessionDependency = Annotated[AsyncSession, Depends(get_session)]

@router.get("/get/{id}", response_model=FriendsRead)
async def get_friends(id, session: SessionDependency) -> FriendsRead:
    found = await FriendService(session).friends.get_by_uuid(id)
    return FriendsRead.model_validate(found)
    
@router.post("/add", response_model=FriendsRead)
async def add_friend(body: FriendAdd, session: SessionDependency) -> FriendsRead:
    updated = await FriendService(session).add_friend(body.id, body.other_id)
    return FriendsRead.model_validate(updated)
    