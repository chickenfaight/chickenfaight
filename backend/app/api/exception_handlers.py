from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.services.exceptions import AlreadyQueuedError, AlreadyMatchedError, UsernameError


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


EXCEPTION_HANDLERS = {
    AlreadyQueuedError: handle_already_queued,
    AlreadyMatchedError: handle_already_matched,
    UsernameError: handle_username_error,
}

def register_exception_handlers(app: FastAPI) -> None:
    for exception_type, handler in EXCEPTION_HANDLERS.items():
        app.add_exception_handler(exception_type, handler)
