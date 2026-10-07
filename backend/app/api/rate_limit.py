"""Per-user rate limits for authenticated routes (limits in PROTOCOL.md, "Limits and timings").

State lives in this process's memory, like matchmaking (BACKEND.md), so it resets on restart.
"""

import math
import time
from collections.abc import Callable
from typing import Any
from uuid import UUID

from fastapi import Depends

from app.auth.dependencies import CurrentUserDependency
from app.services.exceptions import RateLimitedError


class TokenBucket:
    """Each key may spend `burst` requests at once, then `per_minute` as tokens refill."""

    # Above this many tracked keys, forget keys whose buckets have refilled (idle users).
    PRUNE_ABOVE = 10_000

    def __init__(self, burst: int, per_minute: int, clock: Callable[[], float] = time.monotonic):
        self.burst = burst
        self.rate = per_minute / 60
        self.clock = clock
        self.buckets: dict[UUID, tuple[float, float]] = {}

    def take(self, key: UUID) -> int | None:
        """Spend one token; returns None if allowed, else whole seconds until a token refills."""
        now = self.clock()
        tokens = self._tokens(key, now)
        if tokens < 1:
            self.buckets[key] = (tokens, now)
            return math.ceil((1 - tokens) / self.rate)
        if len(self.buckets) > self.PRUNE_ABOVE:
            self._prune(now)
        self.buckets[key] = (tokens - 1, now)
        return None

    def _tokens(self, key: UUID, now: float) -> float:
        tokens, last = self.buckets.get(key, (self.burst, now))
        return min(self.burst, tokens + (now - last) * self.rate)

    def _prune(self, now: float) -> None:
        self.buckets = {key: value for key, value in self.buckets.items() if self._tokens(key, now) < self.burst}


_limiters: list[TokenBucket] = []


def rate_limit(burst: int, per_minute: int) -> Any:
    """A route dependency that rate-limits the signed-in user; use it in `dependencies=[...]`.

    Each call makes its own bucket; share the returned dependency to share a bucket across routes.
    """
    bucket = TokenBucket(burst, per_minute)
    _limiters.append(bucket)

    async def check(user: CurrentUserDependency) -> None:
        retry_after = bucket.take(user.id)
        if retry_after is not None:
            raise RateLimitedError(retry_after)

    return Depends(check)


def reset_rate_limits() -> None:
    """Forget all usage; for tests."""
    for bucket in _limiters:
        bucket.buckets.clear()
