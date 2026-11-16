# Testing

Run the backend with `uv run pytest` from `backend/`, frontend unit tests with
`pnpm test` and browser tests with `pnpm test:e2e` from `frontend/`, and BILC with
`go test -race ./...` from `bilc/`. CI is configured to run all suites. Tests use deterministic
models and local fake HTTP servers; no provider credentials or Ollama are needed.

## Backend (pytest)

Tooling: `pytest`, `pytest-asyncio`, `pytest-cov`, `respx` (dev dependencies; config in `pyproject.toml`, `asyncio_mode = "auto"`, session-scoped event loop). Run with `uv run pytest` from `backend/`.

```
backend/tests/
  conftest.py       fixtures: db_session, make_user, client, log_in
  unit/             pure logic/adapters — no DB or external network
  integration/      HTTP/WS endpoints against a real test database
```

Files are `test_<module>.py`, mirroring `app/`, with unique basenames across folders. Older `unittest`-style files in `tests/` still run under pytest.

**Database.** Use real Postgres, not mocks or SQLite: a separate `chickenfaight_test` database set by `TEST_POSTGRES_URL`. Its name must end in `_test` and it must differ from `POSTGRES_URL`; unsafe targets fail before any reset. Integration tests skip without a URL locally and fail in CI. Once per session the database is wiped and built by running the Alembic migrations (`app.db.migrate`), never `create_all`, so every run tests the migrations. Each test runs inside an outer transaction that is rolled back, with the session bound using `join_transaction_mode="create_savepoint"` so services' own `session.begin()`/`commit()` still work. `make_user` commits its rows so a service's rollback can't undo them.

**HTTP.** Use `httpx.AsyncClient` with `ASGITransport(app=app)` (the `client` fixture overrides `get_session` with the test session). `log_in(user)` overrides `get_current_user`; the cookie itself is tested in `test_auth_sessions.py`.

**Mocking models.** Engine tests use scripted clients (`RecordingClient`,
`ScriptedClient`) and fake device sockets, patching the engine's client lookup.
`test_judge_client.py` checks the real judge adapter's request and refusal handling.
`test_inference_http.py` runs the real SDK against a loopback HTTP/SSE server for
fragmentation, content-only streaming, HTTP failures, and cancellation.

**Coverage.** `uv run pytest --cov=app --cov-branch --cov-report=term-missing
--cov-report=xml` produces branch coverage and `coverage.xml` (uploaded in CI).
Review uncovered behavior rather than requiring an arbitrary global percentage.

### Required coverage

Every backend feature ships with tests for both behavior and security:

- **Every endpoint:** happy path; unauthenticated → 401; another user's resource → 404/403; invalid input → 422.
- **WebSockets:** reject unauthenticated (4401), non-participant or revoked (4403); a second connection replaces the first (4409); unknown `type` → `UNKNOWN_TYPE`. BILC rejects wrong `protocol_version` (4426); the browser JOIN/version handshake remains planned.
- **Engine** (with scripted model clients): opening turns; one prompt per player; deadlines → forfeit; both miss → void; implemented rows of the failure table in PROTOCOL.md; judge output parsing (valid, invalid, invalid-then-retry); successful recording runs once. Later phases remain planned.
- **Prompt safety:** `format_game` strips delimiter strings from player prompts; player prompts never appear in judge messages or in other users' responses; over-length output is truncated at 2000 characters without failing the turn, including from a BYOM device that ignores `max_tokens` (`test_engine_arena.py`, `test_engine_byom.py`).
- **Ladders** (`test_ladder_seed.py`): provisioning adds a ladder per active model plus one BYOM ladder, repeats safely, skips inactive models, adds a ladder when a model's ID changed, and makes queueing work; a missing ladder is a 404 with a logged warning.
- **Elo and matchmaking:** Elo math against hand-computed values; per-ladder isolation; queue pairing window; forfeit vs. void rating effects. Quick Queue cancellation allows rejoining without duplicate entries and removes the correct entry even after transfer to a model queue.
- **Migrations** (`test_migrations.py`, `test_migration_history.py`, already written): one head; models match migrations; full downgrade/upgrade round trip; startup keeps data on a current DB, resets only unrecoverable DBs and only when allowed; drift warning. New migrations need no new tests unless they move data.
- **User tags:** format and profanity rules (including innocent words that contain short profanity); taken ignoring case; set once, never changed (including by sign-in); matchmaking refuses users without a tag. **Usernames:** change any number of times without touching the tag; not unique; blank, over-long, control or invisible characters, and profanity rejected; Google sign-in starts them from the Google name.
- **OpenRouter model importer:** catalogue HTTP errors and validation; only models in `arena_models.txt` are kept; explicit zero pricing (including extra charges, unknown and dynamic prices); models with `reasoning.mandatory` are skipped, and delisted if they start requiring it; one OpenRouter provider across model authors; deduplication and repeat imports preserve UUIDs and activation flags; refresh updates limits/metadata; unrelated rows remain unchanged; models leaving the free list, or going paid, are deactivated and leave the arena list and queue; they return with the same UUID when free again; hand-deactivated models stay off; an empty catalogue deactivates nothing.
- **Homepage arena stats** (`test_arena_stats.py`): caller-only totals and points, authentication, no-match defaults, completed and forfeited wins/losses, void exclusion, and newest-first recent form capped at five.
- **Leaderboards** (`test_leaderboards.py`): session auth and rate limit, active model and BYOM ladders, per-ladder Elo and eligibility, stable ties across pages, the top-50 cap, and public player fields only.
- **Profiles and search:** responses carry only `UserPublic`/`UserProfile` fields (never email); unknown tag → 404 `NOT_FOUND`; ranking order across tags and usernames, with an exact tag first; typo tolerance on both; LIKE wildcards in the query match literally; pagination and `next_offset`; blank query → no items.
- **Password auth** (`test_password_auth.py`): signup signs in; only a salted hash is stored; taken tags (ignoring case) and invalid tags are rejected; malformed bodies, including a client-sent `password_hash`, get 422; wrong password, unknown tag, and Google-only account get the identical 401; signup is rate-limited per IP; login per IP and per tag.
- **Route auth** (`test_route_auth.py`): every HTTP route in the OpenAPI schema returns 401 without a session unless it's on the public allowlist, so a new route can't ship public by accident; API docs follow `APP_ENV`; CORS allows only the frontend; the match socket rejects no session (4401), a foreign or missing Origin (4403), and players not in the match (4403). Socket tests use `TestClient(app)` without `with`, because startup would migrate the real database.
- **Match history** (`test_match_history.py`, `test_match_ratings.py`, engine tests): saved models, arguments, and Elo; win, loss, and void for each outcome; newest-first paging; owner-only lists and participant-only details return 404 otherwise; prompts are never returned; deleted players, topics, and models; a player deleted mid-match; the result is saved before players are told; the migration backfills cloud model names.
- **Daily challenges and rewards** (`test_challenge.py`, `test_rewards.py`, `test_challenge_api.py`, engine tests): twists rotate by day and check limits and whole words; points for judged, forfeited, and voided matches; streaks count new days only, reset after 48 h, read as 0 after lapsing, and pay a 7th-day bonus; the challenge pays once per day and only on its own day; deleted players leave their opponent's history; rank ties; `/v1/challenge/today`; completed players can't requeue; the daily queue is separate; the engine enforces and announces the twist, uses the day's topic, and records once. An autouse fixture stubs `report_game` so engine tests never write through the real `SessionFactory`; opt out with `@pytest.mark.records_matches`.
- **Tips chat** (`test_tips.py`, with a fake model client): streams from the chosen model; the system prompt comes first and contains every tip; player text can't add a system turn; malformed, non-alternating, and oversized conversations are rejected before any model call; inactive models get 404; failure before replying is 502, failure mid-reply ends with a note; rate limit.
- **Profile pictures** (`test_avatars.py`, `test_avatars_api.py`): accepted formats become 256×256 WebP; EXIF including GPS is stripped; rotation is applied; transparency kept; non-images, disguised SVG/script, GIF, truncated files, oversized uploads, and huge pixel counts are rejected without storing anything; uploads get a new versioned URL; removal; Google sign-in keeps an uploaded picture; auth required.
- **Account deletion** (`test_account_deletion.py`): deletes the user and every session; the user disappears from friends lists (both directions), profiles, and search; leaves the queue; forfeits a live match; requires auth.
- **Admin topics** (`test_admin_topics.py`, `test_admins.py`): `ADMIN_TAGS` entries are valid tags; the check ignores case; untagged and other players get 403 `FORBIDDEN` on every admin route, even with a malformed body, and add nothing; `/auth/me` reports `is_admin`; uploads add new topics, skip duplicates (stored or within the list), and can add inactive ones; malformed lines, empty lists, and too many topics are 422 `TOPICS_INVALID` and add nothing; malformed bodies are 422.
- **Sessions** (`test_auth_sessions.py`): Google sign-in starts a session that `/auth/me` accepts; only the token's hash is stored; missing, unknown, malformed, forged, and expired tokens and deleted users get 401; logout revokes the token so a copied cookie fails, and only ends that one session; sign-in clears that user's expired sessions.
- **Friends** (`test_friends.py`, `test_migrations.py`): a request makes no friendship until accepted; sending is idempotent; requesting someone who asked you, or a friend; only the receiver can accept; declining and withdrawing, and asking again; many friends and requests at once, and shared friends; removing ends it for both and leaves other friendships; outsiders can't touch a request; self → 422 `FRIEND_SELF`; unknown or untagged player → 404; a sender without a tag → 403; responses carry only `UserPublic` fields; deleted users leave friends and requests; `is_friend` and `friend_request` reflect the caller only; rate limits. Two players requesting each other at once, on separate connections, become friends with nothing left pending (it fails without `lock_pair`). The migration turns one-way adds into requests, keeps mutual ones, and restores both on downgrade.
- **Blocks** (`test_blocks.py`): the blocked player gets `read_blocked` with only the blocker's ID and tag; the blocker sees `is_blocked`; unblocking restores the profile and leaves the other player's block, which the player can still see and lift from the blocked profile; blocking and unblocking are idempotent; blocking ends friendships and requests both ways; neither player can send a request (404); self → 422 `BLOCK_SELF`; unknown or untagged player → 404; deleted users leave no blocks; the blocked list shows only the caller's own blocks, newest first, with only `UserPublic` fields, pages with `next_offset`, and drops unblocked players; rate limits.
- **Rate limits:** `TokenBucket` unit tests with a fake clock (burst, refill, cap, rejected requests cost nothing, per-key isolation, pruning); per route, request burst + 1 gets 429 `RATE_LIMITED` with `Retry-After`. An autouse fixture resets limits between tests.
- **BILC auth** (`test_bilc.py`): pairing codes are single-use and expire, and accept lowercase and hyphens; refresh tokens rotate and expire after 30 days unused; reusing an old refresh token revokes the device and closes its socket, while a wrong one doesn't revoke; revoked devices are rejected; only hashes are stored; device info is validated; device lists and revocation act only on the caller's devices; account deletion removes devices; rate limits. The socket's token check (`get_bilc_identity`, called directly with the test database patched in) rejects missing, forged, expired, wrong-audience, `alg: none`, and incomplete tokens (4401), unknown devices (4401), and revoked or wrongly owned devices (4403).
- **BYOM** (`test_bilc_rules.py`, `test_bilc_turns.py`, `test_engine_byom.py`, `test_byom_queue.py`, `test_matchmaking.py`): size classes and their boundaries, unknown sizes, and version checks (dev builds only in development); `tests/fake_bilc.py`, a fake BILC device on an in-memory socket run by the real `BilcConnections`, covers status and reservations, `MATCH_ASSIGN`/`FORFEIT`/`MATCH_END`, re-sending the assignment after a reconnect, turns streaming in order with the right `TURN_REQUEST`, device errors, disconnects mid-turn, offline devices, ignored unknown or abandoned turns, malformed responses, and 4426 for outdated clients. The real engine with two fake devices covers: each turn goes to its own player's device with only that player's strategy, the author's stream and `TURN_END`, judging, and `MATCH_END` with devices idle afterwards; a device error, a silent device (timeout), empty output, and an offline device each forfeit that side only, without judging; and resigning mid-turn ends both devices' turns. Pairing: same class first, neighbors only after the wait, never two classes apart, longest-waiting first, reservations, offline devices waiting, cancel. Queue route: offline/busy/foreign devices, missing `bilc_id`, `daily`, `bilc_id` on a cloud arena, tags.
- **BILC releases** (`test_bilc_releases.py`, GitHub faked with `respx` or a fake fetch): the public route's shape, no release yet, its rate limit; reading the version, assets, and checksums; nothing published; another component's tag; the 10-minute cache; failures keeping the last answer without an immediate retry.
- **BILC socket** (`test_bilc_socket.py`, `TestClient` with the identity overridden and a fake HELLO recorder): `HELLO` first, `HELLO_ACK`, bad frames and invalid or oversized `HELLO` get `BAD_MESSAGE` without closing, 4426 for another protocol version, `UNKNOWN_TYPE`, `DISCONNECT`, replacement (4409), heartbeats, and 4408 on silence or no `HELLO`.

### Launch regression coverage

- `test_launch_regressions.py`: Quick Queue never enters daily queues regardless of
  insertion order; same-day matches after streak bonuses on days 7/14; exact 48-hour
  boundary; neither/one player joins and departure before the opponent arrives;
  socket replacement prevents old-reader actions; malformed JSON/binary frames,
  prompt boundaries and resubmission; cancelling real engines during join,
  generation, or judging awaits workers; matchmaker shutdown; stale engine cleanup
  preserves a newer assignment; failed recording retries and concurrent reporting.
- `test_result_atomicity.py`: failures during either rating update roll back history,
  turns, rewards, challenge completions, and both ratings; retry and replay are safe;
  NUL output is sanitized; a deleted participant does not prevent opponent history.
- `test_concurrent_writes.py`: independent committed DB connections compete for a
  pairing code, refresh token, case-insensitive signup, block/accept, and overlapping
  match reports. Rewards/ratings are not lost and daily bonuses remain once per day.
- `test_database_safety.py`: destructive test utilities reject unsafe database URLs.
  `test_production_config.py`: a fresh process verifies secure/HTTP-only/SameSite
  cookies, expiry, production docs disabled, and allowed/rejected CORS preflights,
  without invoking production lifespan or touching a database.

## Frontend

Unit tests use Node's built-in runner (`pnpm test`, Node 24+) for protocol validation.
Playwright is the only new frontend test dependency: it exercises real browser
cookies, SSR, React Strict Mode effects, and WebSockets that lint/build cannot.

```bash
cd frontend
pnpm exec playwright install chromium firefox webkit  # once; CI also installs OS deps
pnpm test
pnpm test:e2e
pnpm lint
pnpm build
```

Browser tests run Chromium, Firefox, and WebKit (Safari engine coverage) under `pnpm dev` (Strict Mode). Playwright
starts its own frontend on 127.0.0.1:3100 and `backend/tests/e2e_server.py` on
127.0.0.1:8765. They refuse to reuse existing servers. The test app replaces the
production lifespan, validates `TEST_POSTGRES_URL`, runs migrations and seeds only
that test database, and wires every HTTP/socket/engine DB session to it. Inference
is deterministic; the rest of the app is real. Many users share loopback, so only
this test app increases rate-limit bursts; rate-limit behavior has separate tests.
**Browser tests wipe the test database: never run them alongside backend pytest.**
Backend dependencies (`uv sync`) and Go (for the Go/Python contract test) are required.

- `journey.spec.ts`: signup/login/logout, authenticated reload (raw signed cookie
  forwarding), POST password forms, real two-player cloud match, private prompts,
  literal model output, immediate saved history/stats/leaderboards, cancellation
  and rejoin, model-failure void, daily completion/re-entry rejection, admin denial.
- `match-state.spec.ts`: controlled WebSocket messages verify one connection in
  Strict Mode, prompt rejection/retry, heartbeat echo, streamed text, waiting and
  judging transitions, result retention after closure, malformed-message recovery,
  heartbeat silence/unmount cleanup, and resign-before-navigation.
- `recovery.spec.ts`: queue conflicts, delisted model recovery, history error/retry/
  empty state, session expiry, network-loss recovery without duplicate registration, and account edits surviving reload.
- `account-social.spec.ts`: avatar format validation/upload/reload/removal and
  two-player friend request/accept/block/unblock flows against the real API.
- `byom-contract.spec.ts`: builds a test-only Go executable from `bilc/tests/contract`
  and runs real Go auth/connection/model/match components against the Python backend,
  two browsers, and a local fake SSE model. Asserts streamed arguments and both
  devices returning idle. Credentials live only in memory; no user config/keychain
  or installed Ollama is accessed.

Traces are retained on failure in `frontend/test-results/` and uploaded by CI.
UI changes still need visual browser verification beyond these assertions.

## BILC (Go, spec)

Use the standard `testing` package; run with `go test -race ./...` from `bilc/`.

The `BILC checks` job in `.github/workflows/ci.yml` runs alongside frontend and
backend checks on pull requests, pushes to `main`, and manual runs. It uses the
Go version from `bilc/go.mod`. Run the same checks locally from `bilc/`:

```bash
test -z "$(gofmt -l .)"
go vet ./...
go test -v -race -count=1 -timeout=5m ./...
go build ./...
```

The formatting check fails if any Go file needs formatting; `go vet` checks for
likely mistakes. Tests run with race detection, without cached results, and with
a five-minute timeout per package. No Ollama installation, models, backend, or
credentials are required.

- **Implemented CLI/lifecycle:** help/version and argument errors; reuse of an existing Ollama service without starting or stopping it; owned process readiness and cancellation; early/unexpected process exit; readiness timeout cleanup; missing executable; rejecting a non-Ollama HTTP response. Use an `httptest.Server` and test subprocesses, without requiring a real Ollama installation or loading models.

- **Implemented config/auth/connection** (`internal/config`, `internal/auth`, `internal/conn`, `cmd/bilc/commands_test.go`): config defaults, round trip, and `0600`/`0700` modes; `BILC_CONFIG_DIR` beating the OS convention, rejecting a relative path, and keeping devices apart; loopback detection; token rotation stores the new refresh token, caches the access token, refreshes near expiry, and deletes credentials on `TOKEN_INVALID`; the keychain-less file fallback warns once; `pair`/`unpair`/`status`/`model set` against a fake REST server with an in-memory store. Against a fake WebSocket server: `HELLO` first with the bearer token, heartbeat echo byte-for-byte, `DISCONNECT` and close 1000 on Ctrl-C, `UNKNOWN_TYPE` replies, garbage ignored, reconnect after a drop, 4408 after silence, refresh after an HTTP 403 handshake or 4403, and stopping on `ErrNotPaired`, 4426, and 4409.
- **Update check** (`internal/update/update_test.go`, `cmd/bilc/commands_test.go`): up to date, update available, numeric version order, below the minimum, no release yet, unreadable versions, `dev` builds making no request, failed requests; `bilc run` printing the notice, refusing an unsupported version, and carrying on when the check fails.
- **Installer** (`bilc/tests/installer_test.go`, also fresh-install smoke in the release workflow): serve a GoReleaser snapshot (`goreleaser release --snapshot --clean`) with `python3 -m http.server --directory dist`, then run `BILC_DOWNLOAD_URL=http://127.0.0.1:<port> BILC_INSTALL_DIR=<tmp> sh install.sh`: a fresh install, a re-run (already installed), an update from an older binary, and a tampered `checksums.txt` (nothing installed). Use `dash` to catch non-POSIX shell.

- **Implemented model client and match handler** (`internal/model/openai_test.go`, `internal/match/handler_test.go`): against an `httptest` SSE server, deltas then one `Done` with the finish reason, the model and messages sent unchanged, reasoning fields dropped, a finish reason without `[DONE]`, malformed and error events and early ends (`ErrBadResponse`), error status at setup, unreachable (`ErrUnavailable`), cancellation while the model hangs and while nobody reads (no leaked goroutine), and Ollama `/api/show` and `/api/generate`. With a fake `model.Model`: streamed `MATCH_RESPONSE`s ending in `done`, each failure's `ERROR` code with its `turn_id`, `MATCH_END`/`FORFEIT`/disconnect cancelling a turn with no late output, one match and one turn at a time, and malformed messages.

Match-handler tests inject a fake `model.Model` (scripted chunks, completion, errors, and cancellation), independently of the real inference client. Test that a final chunk's text is forwarded, unexpected channel closure fails the turn, and cancelled turns cannot send late output. The real model client's tests must cover setup versus mid-stream errors, terminal chunk/channel closure, and cancellation while blocked on HTTP reads or chunk delivery. Normal tests require neither Ollama, production credentials, nor a running backend.

- **Fake local model:** an `httptest.Server` serving scripted OpenAI-compatible SSE streams (normal, slow, error status, malformed chunk, hang).
- **Fake server:** an `httptest.Server` WebSocket endpoint that runs scripted PROTOCOL exchanges and records what BILC sends.
- **Must cover:** `HELLO` first and version fields; heartbeat echo; reconnect with backoff; JWT refresh before expiry and on 4401; credential wipe on `TOKEN_INVALID` (all implemented); `TURN_REQUEST` → streamed `MATCH_RESPONSE` ending in `done: true`; each model failure → the right `ERROR` code; `MATCH_END`/`FORFEIT` cancels an in-flight turn; `BILC_BUSY` on a second `MATCH_ASSIGN`; update verification rejects a bad checksum or signature.

### Additional automated BILC checks

`cmd/bilc/run_command_test.go` runs the real command in a subprocess with fake
Ollama readiness/model and REST/WebSocket servers: full turn streaming, rotation,
SIGINT shutdown, and revoked credentials clearing the local identity. Readiness is
redirected only inside the test subprocess; no installed service is touched.
`tests/installer_test.go` checks fresh/repeat installs, upgrade, missing/bad checksum,
and a truncated archive with a matching checksum; failed updates preserve the old
binary and leave no installation temporary files. These run in the normal race suite.

## Deployment checks still requiring the target environment

**Flagged existing issues, left unfixed in this test-focused change:**
`test_incomplete_sse_must_not_be_accepted_as_a_completed_turn` is a strict pytest
expected failure: the cloud SDK adapter currently treats EOF after partial text
without a completion marker as success. A future fix will produce XPASS and fail
CI until the marker is removed. Firefox settings reload also emitted a hydration
warning for the delete-account button's restored `disabled` attribute; account
editing still passes, but the warning needs a separate UI fix.

CI builds the backend production image and checks non-root execution and imports
with production docs disabled; image publication waits for all CI checks on the
same tagged source. The application's production lifespan is never run in pytest.
The browser harness separately proves test migrations, provisioning, real match
persistence, and component shutdown.

The following remain **unverified against a deployed environment**, and must be
checked once hosting, domains, and proxy configuration exist:

- HTTPS/WSS certificates, real cookie delivery across the chosen domains, reverse
  proxy WebSocket upgrades/timeouts, trusted forwarded IPs and OAuth redirect URL.
- Real Google consent/callback and the selected live inference provider/models.
- Container startup/restart against a disposable DB using deployment configuration;
  SIGTERM while matches/results are in flight, the host's termination grace period,
  and restart behavior with the single-worker topology. Unit cancellation tests do
  not prove signal propagation through the final hosting stack.
- Real OS keychain, installed Ollama process ownership/signals on macOS/Linux/Windows,
  platform release archives, and physical two-machine network behavior.

These are deployment/platform-dependent, not inherently impossible to automate;
add a staging smoke job once those concrete resources are available. Full browser
reconnect snapshots, later debate phases, and signed self-updates remain planned
features and are not represented as passing coverage. A prolonged DB outage or a
hard process kill can still lose an in-memory result; no durable outbox is claimed.
