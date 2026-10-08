import asyncio
import logging
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.rate_limit import rate_limit
from app.auth.dependencies import CurrentUserDependency
from app.db.session import get_session
from app.engine.game_engine import MODEL_ERRORS
from app.inference.model_client import OpenAIModelClient
from app.schemas import TipsChatRequest, TipsTip
from app.services.arena import ArenaService
from app.services.exceptions import ConversationInvalidError, ConversationTooLongError, ModelUnavailableError
from app.services.tips import MAX_CONVERSATION_CHARS, MAX_REPLY_TOKENS, TIPS, format_tips

router = APIRouter(prefix="/tips", tags=["tips"])
SessionDependency = Annotated[AsyncSession, Depends(get_session)]
logger = logging.getLogger(__name__)

FIRST_TOKEN_TIMEOUT = 30
REPLY_TIMEOUT = 90


@router.get("", response_model=TipsTip)
async def list_tips(_user: CurrentUserDependency) -> TipsTip:
    return TipsTip(tips=list(TIPS))


@router.post("/chat", dependencies=[rate_limit(burst=5, per_minute=10)])
async def chat(body: TipsChatRequest, _user: CurrentUserDependency, session: SessionDependency) -> StreamingResponse:
    """Stream the coach's reply to the conversation as plain text."""
    roles = [message.role for message in body.messages]
    if roles[0] != "user" or roles[-1] != "user" or any(a == b for a, b in zip(roles, roles[1:])):
        raise ConversationInvalidError()
    if sum(len(message.content) for message in body.messages) > MAX_CONVERSATION_CHARS:
        raise ConversationTooLongError()
    model = await ArenaService(session).get_active(body.model_id)
    await session.close()  # don't hold a database connection while the reply streams

    client = OpenAIModelClient(model=model.api_model_id)
    stream = client.stream(format_tips([m.model_dump() for m in body.messages]), max_tokens=MAX_REPLY_TOKENS)
    # Wait for the first text before sending headers, so a failing model is a clean 502, not an empty 200.
    try:
        async with asyncio.timeout(FIRST_TOKEN_TIMEOUT):
            first = await anext(stream)
    except (StopAsyncIteration, *MODEL_ERRORS) as exc:
        logger.warning("Tips chat on %s failed: %r", model.api_model_id, exc)
        await stream.aclose()
        await client.client.close()
        raise ModelUnavailableError() from None

    async def reply() -> AsyncIterator[str]:
        try:
            yield first
            async with asyncio.timeout(REPLY_TIMEOUT):
                async for delta in stream:
                    yield delta
        except MODEL_ERRORS as exc:
            logger.warning("Tips chat on %s stopped: %r", model.api_model_id, exc)
            yield "\n\n[The model stopped responding.]"
        finally:
            await stream.aclose()
            await client.client.close()

    return StreamingResponse(reply(), media_type="text/plain; charset=utf-8",
                             headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
