from uuid import uuid4

from app.api.rate_limit import TokenBucket


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def test_allows_a_burst_then_limits():
    bucket = TokenBucket(burst=3, per_minute=60, clock=FakeClock())
    key = uuid4()
    assert [bucket.take(key) for _ in range(3)] == [None, None, None]
    assert bucket.take(key) == 1


def test_refills_over_time():
    clock = FakeClock()
    bucket = TokenBucket(burst=2, per_minute=30, clock=clock)
    key = uuid4()
    bucket.take(key)
    bucket.take(key)
    assert bucket.take(key) == 2  # one token per 2 s
    clock.now += 2
    assert bucket.take(key) is None
    assert bucket.take(key) is not None


def test_refill_never_exceeds_burst():
    clock = FakeClock()
    bucket = TokenBucket(burst=2, per_minute=60, clock=clock)
    key = uuid4()
    bucket.take(key)
    clock.now += 3600
    assert [bucket.take(key) for _ in range(3)] == [None, None, 1]


def test_rejected_requests_do_not_spend_tokens():
    clock = FakeClock()
    bucket = TokenBucket(burst=1, per_minute=60, clock=clock)
    key = uuid4()
    bucket.take(key)
    for _ in range(5):
        assert bucket.take(key) is not None
    clock.now += 1
    assert bucket.take(key) is None


def test_keys_are_independent():
    bucket = TokenBucket(burst=1, per_minute=60, clock=FakeClock())
    first, second = uuid4(), uuid4()
    assert bucket.take(first) is None
    assert bucket.take(first) is not None
    assert bucket.take(second) is None


def test_prunes_idle_keys():
    clock = FakeClock()
    bucket = TokenBucket(burst=1, per_minute=60, clock=clock)
    bucket.PRUNE_ABOVE = 2
    idle = [uuid4() for _ in range(3)]
    for key in idle:
        bucket.take(key)
    clock.now += 60
    bucket.take(uuid4())
    assert not any(key in bucket.buckets for key in idle)
