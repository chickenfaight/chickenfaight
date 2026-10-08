from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.rate_limit import rate_limit
from app.auth.dependencies import CurrentUserDependency
from app.db.session import get_session
from app.schemas import UserProfile, UserRead, TagAvailability, TagUpdate, UsernameUpdate, UserSearchPage
from app.services.user import UserService


router = APIRouter(prefix="/users", tags=["users"])
SessionDependency = Annotated[AsyncSession, Depends(get_session)]


@router.get(
    "/tag-availability",
    response_model=TagAvailability,
    dependencies=[rate_limit(burst=20, per_minute=60)],
)
async def tag_availability(
    tag: Annotated[str, Query(max_length=64)],
    _user: CurrentUserDependency,
    session: SessionDependency,
) -> TagAvailability:
    return await UserService(session).check_tag_availability(tag)


@router.put("/me/tag", response_model=UserRead)
async def set_tag(
    body: TagUpdate,
    user: CurrentUserDependency,
    session: SessionDependency,
) -> UserRead:
    claimed = await UserService(session).claim_tag(user, body.tag)
    return UserRead.model_validate(claimed)


@router.patch("/me", response_model=UserRead)
async def change_username(
    body: UsernameUpdate,
    user: CurrentUserDependency,
    session: SessionDependency,
) -> UserRead:
    changed = await UserService(session).change_username(user, body.username)
    return UserRead.model_validate(changed)

@router.get("/search", response_model=UserSearchPage, dependencies=[rate_limit(burst=20, per_minute=60)])
async def search_users(
    q: Annotated[str, Query(min_length=1, max_length=64)],
    _user: CurrentUserDependency,
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> UserSearchPage:
    return await UserService(session).search(q, limit, offset)


@router.get(
    "/by-tag/{tag}",
    response_model=UserProfile,
    dependencies=[rate_limit(burst=20, per_minute=60)],
)
async def get_profile(
    tag: Annotated[str, Path(max_length=64)],
    user: CurrentUserDependency,
    session: SessionDependency,
) -> UserProfile:
    return await UserService(session).get_profile(user, tag)
