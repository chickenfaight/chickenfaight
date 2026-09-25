# Testing

What each component must test and how. No test suite exists yet (PLANNED). The first PR that adds tests sets up the tooling below exactly as described.

## Backend (pytest)

Tooling: `pytest`, `pytest-asyncio`, `respx`, added with `uv add --dev pytest pytest-asyncio respx`. Run with `uv run pytest` from `backend/`.

```
backend/tests/
  conftest.py       fixtures: db session, app client, logged-in client, fake models
  unit/             pure logic — no DB, no network
  integration/      HTTP/WS endpoints against a real test database
```

Files are `test_<module>.py`, mirroring `app/`.

**Database.** Use real Postgres, not mocks or SQLite: a separate `chickenfaight_test` database set by `TEST_POSTGRES_URL`. Create tables once per session with `Base.metadata.create_all`. Each test runs inside an outer transaction that is rolled back, with the session bound using `join_transaction_mode="create_savepoint"` so services' own `session.begin()` still works.

**HTTP.** Use `httpx.AsyncClient` with `ASGITransport(app=app)`. Override `get_session` with the test session. Give the logged-in client fixture a valid session cookie for a seeded user.

**Mocking models.** Engine and service tests never touch the network. They use `FakeModelClient`, a test implementation of the `ModelClient` interface in `app/inference/`, built from a script:

```python
FakeModelClient([
    ["Opening ", "argument."],            # turn 1 streams these deltas
    ModelTimeout(),                        # turn 2 times out
    ['{"winner": "pro", "reasoning": "…"}'],  # judge
])
```

Pass it to the engine through its constructor. Only `OpenAIModelClient`'s own tests use `respx` to fake the provider's SSE responses. `BilcModelClient` tests use an in-memory fake device socket.

### Required coverage

Every backend feature ships with tests for both behavior and security:

- **Every endpoint:** happy path; unauthenticated → 401; another user's resource → 404/403; invalid input → 422.
- **Every WS socket:** rejects unauthenticated (4401), non-participant or revoked (4403), wrong `protocol_version` (4426); a second connection replaces the first (4409); unknown `type` → `UNKNOWN_TYPE`.
- **Engine** (with `FakeModelClient`): turn order and phases; one prompt per player; deadlines → forfeit; both miss → void; every row of the failure table in PROTOCOL.md; judge output parsing (valid, invalid, invalid-then-retry); `report_game` runs once.
- **Prompt safety:** `format_game` strips delimiter strings from player prompts; player prompts never appear in judge messages or in other users' responses; over-length output is truncated.
- **Elo and matchmaking:** Elo math against hand-computed values; per-ladder isolation; queue pairing window; forfeit vs. void rating effects.
- **BILC auth:** pairing codes are single-use and expire; refresh tokens rotate; reusing an old refresh token revokes the device; revoked devices are rejected; only hashes are stored.

## Frontend

No test framework has been chosen. Don't add one without team agreement. Until then, every frontend change must:
- pass `pnpm lint` and `pnpm build`;
- be used in a browser, covering the golden path plus the loading, empty, and error states from FRONTEND.md.

## BILC (Go, spec)

Use the standard `testing` package; run with `go test -race ./...` from `bilc/`.

- **Fake local model:** an `httptest.Server` serving scripted OpenAI-compatible SSE streams (normal, slow, error status, malformed chunk, hang).
- **Fake server:** an `httptest.Server` WebSocket endpoint that runs scripted PROTOCOL exchanges and records what BILC sends.
- **Must cover:** `HELLO` first and version fields; heartbeat echo; reconnect with backoff; JWT refresh before expiry and on 4401; credential wipe on `TOKEN_INVALID`/4403; `TURN_REQUEST` → streamed `MATCH_RESPONSE` ending in `done: true`; each model failure → the right `ERROR` code; `MATCH_END`/`FORFEIT` cancels an in-flight turn; `BILC_BUSY` on a second `MATCH_ASSIGN`; update verification rejects a bad checksum or signature.
