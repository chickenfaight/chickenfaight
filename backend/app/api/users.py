from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUserDependency
from app.db.session import get_session
from app.schemas import UserRead, UsernameAvailability, UsernameUpdate
from app.services.user import UserService


router = APIRouter(prefix="/users", tags=["users"])
SessionDependency = Annotated[AsyncSession, Depends(get_session)]


@router.get("/username-availability", response_model=UsernameAvailability)
async def username_availability(
    username: Annotated[str, Query(max_length=64)],
    _user: CurrentUserDependency,
    session: SessionDependency,
) -> UsernameAvailability:
    return await UserService(session).check_username_availability(username)


@router.patch("/me", response_model=UserRead)
async def set_username(
    body: UsernameUpdate,
    user: CurrentUserDependency,
    session: SessionDependency,
) -> UserRead:
    claimed = await UserService(session).claim_username(user, body.username)
    return UserRead.model_validate(claimed)

@router.get("/user/{username}", response_model=UserRead)
async def get_user(username, session: SessionDependency) -> UserRead:
    found = await UserService(session).users.get_by_username(username)
    return UserRead.model_validate(found)