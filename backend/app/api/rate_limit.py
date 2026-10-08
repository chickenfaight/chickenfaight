"""Rate limits (values in PROTOCOL.md, "Limits and timings"): per signed-in user for authenticated
routes, and per client IP or per account for sign-in and signup, which have no user yet.

State lives in this process's memory, like matchmaking (BACKEND.md), so it resets on restart.
"""

import math
import time
from collections.abc import Callable, Hashable
from typing import Any

from fastapi import Depends, Request

from app.auth.dependencies import CurrentUserDependency
from app.services.exceptions import RateLimitedError


_limiters: list["TokenBucket"] = []


class TokenBucket:
    """Each key may spend `burst` requests at once, then `per_minute` as tokens refill."""

    # Above this many tracked keys, forget keys whose buckets have refilled (idle users).
    PRUNE_ABOVE = 10_000

    def __init__(self, burst: int, per_minute: float, clock: Callable[[], float] = time.monotonic):
        self.burst = burst
        self.rate = per_minute / 60
        self.clock = clock
        self.buckets: dict[Hashable, tuple[float, float]] = {}
        _limiters.append(self)

    def take(self, key: Hashable) -> int | None:
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

    def check(self, key: Hashable) -> None:
        """Spend one token for `key` or raise `RateLimitedError`."""
        retry_after = self.take(key)
        if retry_after is not None:
            raise RateLimitedError(retry_after)

    def _tokens(self, key: Hashable, now: float) -> float:
        tokens, last = self.buckets.get(key, (self.burst, now))
        return min(self.burst, tokens + (now - last) * self.rate)

    def _prune(self, now: float) -> None:
        self.buckets = {key: value for key, value in self.buckets.items() if self._tokens(key, now) < self.burst}


def rate_limit(burst: int, per_minute: float) -> Any:
    """A route dependency that rate-limits the signed-in user; use it in `dependencies=[...]`.

    Each call makes its own bucket; share the returned dependency to share a bucket across routes.
    """
    bucket = TokenBucket(burst, per_minute)

    async def check(user: CurrentUserDependency) -> None:
        bucket.check(user.id)

    return Depends(check)


def rate_limit_by_ip(burst: int, per_minute: float) -> Any:
    """Like `rate_limit`, keyed by client IP, for routes used before signing in.

    Behind a reverse proxy every request shares the proxy's IP; configure the server to trust
    the proxy's forwarded-for header there (e.g. uvicorn `--proxy-headers`).
    """
    bucket = TokenBucket(burst, per_minute)

    async def check(request: Request) -> None:
        bucket.check(request.client.host if request.client else None)

    return Depends(check)


def reset_rate_limits() -> None:
    """Forget all usage; for tests."""
    for bucket in _limiters:
        bucket.buckets.clear()
