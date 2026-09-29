from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.services.exceptions import AlreadyQueuedError, AlreadyMatchedError


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


EXCEPTION_HANDLERS = {
    AlreadyQueuedError: handle_already_queued,
    AlreadyMatchedError: handle_already_matched,
}

def register_exception_handlers(app: FastAPI) -> None:
    for exception_type, handler in EXCEPTION_HANDLERS.items():
        app.add_exception_handler(exception_type, handler)
