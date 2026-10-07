# Testing

What each component must test and how. Current backend regression tests use
`unittest`: run `.venv/bin/python -m unittest discover -s tests -v` from `backend/`.
They include topic-file parsing checks; database-backed importer/repository coverage
is still pending. The pytest tooling and database fixtures below are PLANNED.

## Backend (pytest)

Tooling: `pytest`, `pytest-asyncio`, `respx` (dev dependencies; config in `pyproject.toml`, `asyncio_mode = "auto"`, session-scoped event loop). Run with `uv run pytest` from `backend/`.

```
backend/tests/
  conftest.py       fixtures: db_session, make_user, client, log_in (fake models PLANNED)
  unit/             pure logic — no DB, no network
  integration/      HTTP/WS endpoints against a real test database
```

Files are `test_<module>.py`, mirroring `app/`, with unique basenames across folders. Older `unittest`-style files in `tests/` still run under pytest.

**Database.** Use real Postgres, not mocks or SQLite: a separate `chickenfaight_test` database set by `TEST_POSTGRES_URL` (integration tests skip without it). Once per session the database is wiped and built by running the Alembic migrations (`app.db.migrate`), never `create_all`, so every run tests the migrations. Each test runs inside an outer transaction that is rolled back, with the session bound using `join_transaction_mode="create_savepoint"` so services' own `session.begin()`/`commit()` still work. `make_user` commits its rows so a service's rollback can't undo them.

**HTTP.** Use `httpx.AsyncClient` with `ASGITransport(app=app)` (the `client` fixture overrides `get_session` with the test session). `log_in(user)` overrides `get_current_user`; the cookie itself is tested in `test_auth_session.py`.

**Mocking models.** Engine and service tests never touch the network. They use `FakeModelClient`, a test implementation of the `ModelClient` interface in `app/inference/`, built from a script:

```python
FakeModelClient([
    ["Opening ", "argument."],            # turn 1 streams these deltas
    ModelTimeout(),                        # turn 2 times out
    ['{"winner": "pro", "reasoning": "…"}'],  # judge
])
```

Pass it to the engine through its constructor. Only `OpenAIModelClient`'s own tests touch the SDK, by replacing `client.chat.completions` with a fake (`respx` can't intercept the SDK's HTTP client). `BilcModelClient` tests use an in-memory fake device socket.

### Required coverage

Every backend feature ships with tests for both behavior and security:

- **Every endpoint:** happy path; unauthenticated → 401; another user's resource → 404/403; invalid input → 422.
- **Every WS socket:** rejects unauthenticated (4401), non-participant or revoked (4403), wrong `protocol_version` (4426); a second connection replaces the first (4409); unknown `type` → `UNKNOWN_TYPE`.
- **Engine** (with `FakeModelClient`): turn order and phases; one prompt per player; deadlines → forfeit; both miss → void; every row of the failure table in PROTOCOL.md; judge output parsing (valid, invalid, invalid-then-retry); `report_game` runs once.
- **Prompt safety:** `format_game` strips delimiter strings from player prompts; player prompts never appear in judge messages or in other users' responses; over-length output is truncated.
- **Elo and matchmaking:** Elo math against hand-computed values; per-ladder isolation; queue pairing window; forfeit vs. void rating effects.
- **Migrations** (`test_migrations.py`, `test_migration_history.py`, already written): one head; models match migrations; full downgrade/upgrade round trip; startup keeps data on a current DB, resets only unrecoverable DBs and only when allowed; drift warning. New migrations need no new tests unless they move data.
- **User tags:** format and profanity rules (including innocent words that contain short profanity); taken ignoring case; set once, never changed (including by sign-in); matchmaking refuses users without a tag.
- **Profiles and search:** responses carry only `UserPublic`/`UserProfile` fields (never email); unknown tag → 404 `NOT_FOUND`; ranking order; typo tolerance; LIKE wildcards in the query match literally; pagination and `next_offset`; blank query → no items.
- **Sessions** (`test_auth_sessions.py`): Google sign-in starts a session that `/auth/me` accepts; only the token's hash is stored; missing, unknown, malformed, forged, and expired tokens and deleted users get 401; logout revokes the token so a copied cookie fails, and only ends that one session; sign-in clears that user's expired sessions.
- **Friends:** add, remove, and list act only on the caller's own list; adding is one-way and idempotent; self → 422 `FRIEND_SELF`; unknown or untagged player → 404; responses carry only `UserPublic` fields; a deleted user leaves friends lists; `is_friend` reflects the caller only.
- **Rate limits:** `TokenBucket` unit tests with a fake clock (burst, refill, cap, rejected requests cost nothing, per-key isolation, pruning); per route, request burst + 1 gets 429 `RATE_LIMITED` with `Retry-After`. An autouse fixture resets limits between tests.
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
