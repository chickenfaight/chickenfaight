from fastapi import HTTPException, status
from starlette._utils import get_route_path
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Message, Receive, Scope, Send


DEFAULT_MAX_BODY_BYTES = 8 * 1024
# Allow up to 12 wire bytes per character for JSON-escaped Unicode, plus the envelope.
ROUTE_LIMITS = {
    ("POST", "/v1/tips/chat"): 512 * 1024,
    ("POST", "/v1/admin/topics"): 2560 * 1024,
}


class RequestBodyTooLarge(HTTPException):
    def __init__(self) -> None:
        super().__init__(status.HTTP_413_CONTENT_TOO_LARGE, "Request body exceeds the route's byte limit.")


class RequestBodyLimitMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        route = (scope["method"], get_route_path(scope))
        if route == ("PUT", "/v1/users/me/avatar"):
            # The avatar handler already bounds its stream and returns AVATAR_INVALID.
            await self.app(scope, receive, send)
            return

        limit = ROUTE_LIMITS.get(route, DEFAULT_MAX_BODY_BYTES)
        # Compare decimal strings so arbitrarily long declarations need no integer conversion.
        declared_length = Headers(scope=scope).get("content-length", "").lstrip("0")
        limit_text = str(limit)
        declared_too_large = declared_length.isascii() and declared_length.isdecimal() and (
            len(declared_length) > len(limit_text)
            or (len(declared_length) == len(limit_text) and declared_length > limit_text)
        )
        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            if declared_too_large:
                raise RequestBodyTooLarge()
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise RequestBodyTooLarge()
            return message

        await self.app(scope, limited_receive, send)
