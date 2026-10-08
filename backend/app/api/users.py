from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.api.rate_limit import rate_limit
from app.auth.dependencies import CurrentUserDependency
from app.db.session import get_session
from app.schemas import UserProfile, UserRead, TagAvailability, TagUpdate, UsernameUpdate, UserSearchPage
from app.services.avatars import MAX_UPLOAD_BYTES, process_avatar
from app.services.exceptions import AvatarInvalidError
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


@router.put("/me/avatar", response_model=UserRead, dependencies=[rate_limit(burst=5, per_minute=10)])
async def upload_avatar(request: Request, user: CurrentUserDependency, session: SessionDependency) -> UserRead:
    """Replace the caller's picture with the raw image in the request body (PNG, JPEG, or WebP)."""
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_UPLOAD_BYTES:  # stop reading instead of buffering an oversized upload
            raise AvatarInvalidError()
    image = await run_in_threadpool(process_avatar, bytes(body))  # CPU-bound; keep the event loop free
    return UserRead.model_validate(await UserService(session).set_avatar(user, image))


@router.delete("/me/avatar", response_model=UserRead)
async def remove_avatar(user: CurrentUserDependency, session: SessionDependency) -> UserRead:
    return UserRead.model_validate(await UserService(session).remove_avatar(user))


# Looser than other per-user limits: one search page shows 20 pictures at once.
@router.get("/{user_id}/avatar", dependencies=[rate_limit(burst=100, per_minute=300)])
async def get_avatar(user_id: UUID, _user: CurrentUserDependency, session: SessionDependency) -> Response:
    image = await UserService(session).get_avatar_image(user_id)
    # Safe to cache for a long time: each upload gets a new `?v=` in `avatar_url`.
    return Response(image, media_type="image/webp", headers={
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
    })


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(request: Request, user: CurrentUserDependency, session: SessionDependency) -> Response:
    """Permanently delete the caller's account: leave matchmaking (forfeiting a live match), delete
    the user and everything tied to it, and clear the session cookie."""
    request.app.state.matchmaker.remove_user(user.id)
    await UserService(session).delete_account(user)
    request.session.clear()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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
