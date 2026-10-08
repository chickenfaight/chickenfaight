from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.services.exceptions import (
    AlreadyMatchedError,
    AlreadyQueuedError,
    ArenaNotFoundError,
    FriendSelfError,
    RateLimitedError,
    UsernameError,
    UserNotFoundError,
)


async def handle_already_queued(
        request: Request,
        error: AlreadyQueuedError,
) -> JSONResponse:
    return JSONResponse(
        status_code=409,
        content={
            "code": "ALREADY_QUEUED",
            "detail": "User is already queued",
        },
    )

async def handle_already_matched(
        request: Request,
        error: AlreadyMatchedError,
) -> JSONResponse:
    return JSONResponse(
        status_code=409,
        content={
            "code": "IN_MATCH",
            "detail": f"User is already matched in {error.match_id}",
        }
    )


async def handle_username_error(
        request: Request,
        error: UsernameError,
) -> JSONResponse:
    return JSONResponse(
        status_code=error.status_code,
        content={"code": error.code, "detail": error.detail},
    )


async def handle_user_not_found(
        request: Request,
        error: UserNotFoundError,
) -> JSONResponse:
    return JSONResponse(
        status_code=404,
        content={"code": "NOT_FOUND", "detail": error.detail},
    )


async def handle_arena_not_found(
        request: Request,
        error: ArenaNotFoundError,
) -> JSONResponse:
    return JSONResponse(
        status_code=404,
        content={"code": "NOT_FOUND", "detail": "No active arena has that model ID."},
    )


async def handle_friend_self(
        request: Request,
        error: FriendSelfError,
) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={"code": "FRIEND_SELF", "detail": str(error)},
    )


async def handle_rate_limited(
        request: Request,
        error: RateLimitedError,
) -> JSONResponse:
    return JSONResponse(
        status_code=429,
        content={"code": "RATE_LIMITED", "detail": "Too many requests. Try again shortly."},
        headers={"Retry-After": str(error.retry_after)},
    )


EXCEPTION_HANDLERS = {
    AlreadyQueuedError: handle_already_queued,
    AlreadyMatchedError: handle_already_matched,
    ArenaNotFoundError: handle_arena_not_found,
    UsernameError: handle_username_error,
    UserNotFoundError: handle_user_not_found,
    FriendSelfError: handle_friend_self,
    RateLimitedError: handle_rate_limited,
}

def register_exception_handlers(app: FastAPI) -> None:
    for exception_type, handler in EXCEPTION_HANDLERS.items():
        app.add_exception_handler(exception_type, handler)
