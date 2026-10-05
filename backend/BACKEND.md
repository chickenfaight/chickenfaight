# Backend

FastAPI server: REST API, matchmaking, game engine, persistence. Contracts are in [PROTOCOL.md](../PROTOCOL.md); tests in [TESTING.md](../TESTING.md).

## Stack

Python ≥ 3.14 managed with `uv`; FastAPI; SQLAlchemy 2 async + psycopg 3; Alembic (migrations); Pydantic; Authlib (Google OIDC); `better-profanity` (tag filter); PostgreSQL. PLANNED additions: `openai` (inference client), `PyJWT` (BILC tokens).

Use a tool's current idiomatic style: `Annotated` dependencies, `Mapped[...]`/`mapped_column`, Pydantic v2 `model_validate`, `async`/`await` everywhere. Never do blocking I/O in async code.

## Layout

```
app/
  main.py         app, middleware, router registration
  config.py       Settings from env (only place that reads env)
  api/            routers — thin: parse, call a service, return a schema
  auth/           google.py, dependencies.py (session user), bilc.py (JWT, PLANNED)
  services/       business logic; owns transactions and authorization checks
  repositories/   SQLAlchemy queries only, one class per table/aggregate
  models/         ORM classes, one file per aggregate, all exported in __init__.py
  schemas/        Pydantic: request/response bodies, WS messages, JSONB shapes
  engine/         PLANNED — game engine, prompt templates, verdict parsing
  inference/      PLANNED — ModelClient interface + implementations
  db/             base.py, session.py, migrate.py, migrations/ (Alembic), seed.py (temporary topic importer)
```

Dependency direction: `api → services → repositories → models`. `engine` uses `services` and `inference`; nothing imports `api`. Split `schemas/schemas.py` into per-domain files as it grows, re-exported from `schemas/__init__.py`.

Rules:
- Routers declare `response_model` (or a return type) and never return ORM objects.
- Services open transactions with `async with self.session.begin():` (see `UserService.sign_in_with_google`). Exception: on routes using `CurrentUserDependency`, loading the user already began the session's transaction, so the service ends it with `commit()`/`rollback()` instead (see `UserService.claim_username`).
- New env vars go in `Settings` and `.env.example` together; missing required vars fail at startup.

## Auth

State the auth of every endpoint explicitly; PROTOCOL.md lists which are public.
- **Web routes / match socket:** `CurrentUserDependency` (signed session cookie holding only `user_id`).
- **BILC routes / socket:** `BilcDependency` (PLANNED) validating the access JWT.
- **WebSockets:** authenticate and authorize *before* `accept()`.
- **Ownership** (own device, participant in match) is checked in services, not routers. Return 404 for other users' private resources.
- Pairing codes and refresh tokens: generate with `secrets`, store only SHA-256 hashes, compare with `hmac.compare_digest`.

## Game engine (PLANNED)

`app/engine/` — one `GameEngine` instance per match, run as its own asyncio task started by the matchmaker. It owns the match's in-memory state and both player sockets, and follows the match flow and failure table in PROTOCOL.md.

The current engine keeps one receiver and one heartbeat task per browser connection. Accepted prompts are stored separately so the receiver continues reading heartbeat replies. Heartbeats are sent every 15 seconds; 45 seconds without incoming activity closes that socket with 4408. These tasks stop on disconnect or engine completion. Browser echo handling and the rest of the match lifecycle remain pending.

| Method | Responsibility |
|---|---|
| `link_user(user_id)` | Wait for the player's socket to `JOIN` (join deadline); send `MATCH_STATE` |
| `get_user_prompt(socket)` | Receive and validate `SUBMIT_PROMPT`; both required before turns start |
| `format_game(prompt)` | Build the fixed-template `messages` for a turn; player prompt goes only inside delimiters, with delimiter strings stripped from it |
| `call_model(messages)` | Stream a turn from a `ModelClient`, forwarding `TURN_DELTA`s; also used for the judge |
| `unlink_user(socket)` | Send `MATCH_RESULT` and close the socket |
| `report_game()` | Persist the result and Elo via services; called exactly once |

The engine never calls a provider directly. `app/inference/` exposes one `ModelClient` interface (`stream(messages, max_tokens) -> AsyncIterator[str]`) with `OpenAIModelClient` (cloud, `AsyncOpenAI` with `base_url`) and `BilcModelClient` (sends `TURN_REQUEST` to a device, yields `MATCH_RESPONSE` deltas). Tests use a fake implementation.

Live state (matchmaking queues, running engines, connected BILC devices) is in-memory in one server process. Running multiple processes would need a shared store; out of scope.

## User tags

`users.username` is the player's public tag, null until set (PROTOCOL.md: `PATCH /api/v1/users/me`). Rules live in `app/services/usernames.py`:
- Format `[A-Za-z0-9_]{3,24}`; uniqueness ignores case (unique index `uq_users_username_lower`) but the typed casing is kept.
- Profanity: `better-profanity` whole-word check (also split on `_`, camelCase, and letter/digit boundaries), plus a short list of severe stems matched as substrings after undoing leetspeak, because tags glue words together. Ambiguous short words stay whole-word only (`class`, `grape` pass; `Scunthorpe` is a known false positive).
- Set once: `UPDATE ... WHERE username IS NULL` makes the write atomic, and nothing else writes the column (sign-in never touches it). Matchmaking refuses users without a tag.

## Matchmaking and Elo

- One queue per ladder. Pair the two closest-rated players within ±100 Elo; the window widens by 50 every 10 s waited. BYOM players queue only with an online, idle device.
- Elo per `(user, ladder)`: start 1000, K = 32, expected score `1 / (1 + 10^((Rb − Ra)/400))`. Forfeits update Elo as losses; voids don't. Update both ratings in the same transaction as the match result.

## Database schema (target)

Postgres. Constraint and index names come from the naming convention in `app/db/base.py`. UUID PKs everywhere (`Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)`, matching `users.id`), except join/junction tables whose PK is a composite of other tables' UUIDs. Every table has `created_at` (`DateTime(timezone=True)`, `server_default=func.now()`). Enumerated values are Python `StrEnum`s stored with `Enum(..., native_enum=False)` (VARCHAR + CHECK) so they can change without Postgres enum migrations.

| Table | Columns | Notes |
|---|---|---|
| `users` (implemented) | `id` UUID, `google_sub` unique, `email?`, `username?` unique on `lower(username)`, `avatar_url?`, `updated_at` | Drop `elo` when `ratings` ships; `username` is the user's tag (see below) |
| `ladders` | `id` UUID, `slug` unique, `display_name`, `kind` (`cloud`/`byom`), `provider_model_id?`, `is_active`, `provider_metadata` JSONB | Exactly one `byom` row |
| `ratings` | PK(`user_id`, `ladder_id`), `elo` = 1000, `games_played`, `wins`, `losses`, `updated_at` | Created on first queue |
| `topics` (implemented) | `id` UUID, `category`, `topic`, `pro_position`, `con_position`, `is_active` | Text fields are limited to 255 characters; category defaults to `General`; active by default |
| `matches` | `id` UUID, `ladder_id`, `topic_id`, `status`, `winner_side?`, `end_reason?`, `verdict_reasoning?`, `judge_metadata` JSONB, `started_at?`, `ended_at?` | |
| `match_participants` | PK(`match_id`, `side`), `user_id` (unique with `match_id`), `bilc_device_id?`, `prompt?`, `elo_before`, `elo_after?` | `prompt` never exposed to others |
| `turns` | `id` UUID, `match_id`, `index` (unique with `match_id`), `side`, `phase`, `content`, `truncated`, `usage` JSONB | Written as each turn ends |
| `votes` | PK(`match_id`, `user_id`), `side` | Community opinion; never affects Elo |
| `bilc_devices` | `id` UUID, `user_id`, `name`, `platform`, `client_version`, `model_metadata` JSONB, `refresh_token_hash`, `last_seen_at?`, `revoked_at?` | |
| `bilc_pairing_codes` | `code_hash` PK, `user_id`, `expires_at`, `used_at?` | |

`?` = nullable. All FKs are indexed.

### JSONB conventions

- JSONB is only for provider/model metadata and usage: data whose shape varies by provider and is never filtered or joined on. Everything else is a real column.
- Each JSONB column has a Pydantic schema in `app/schemas/`; validate before writing, parse when reading.
- Never put secrets, tokens, or player prompts in JSONB. Cap client-supplied JSON (`model_metadata`) at 4 KB.

| Column | Shape |
|---|---|
| `ladders.provider_metadata` | `{ provider: str, context_length?: int }` |
| `bilc_devices.model_metadata` | `HELLO.model` from PROTOCOL.md |
| `turns.usage` | `{ latency_ms: int, first_token_ms: int, prompt_tokens?: int, completion_tokens?: int, finish_reason?: str }` |
| `matches.judge_metadata` | `{ model: str, attempts: int, raw_output: str, usage: <turns.usage shape> }` |

## Changing the schema

Alembic migrations live in `app/db/migrations/versions/` (config in `pyproject.toml`). The server applies them on every startup (`app/db/migrate.py`, all in one transaction), so after `git pull` you only restart it. Never hand-run SQL against a shared schema.

**Workflow**
1. Start the server once so your local DB is current (autogenerate refuses to run against an outdated DB).
2. Edit or add the model in `app/models/` and export it from `app/models/__init__.py` (unexported models are invisible to Alembic).
3. `uv run alembic revision --autogenerate -m "<what changed>"`.
4. Read the generated file and fix what autogenerate gets wrong (list below). `downgrade()` must undo `upgrade()` exactly.
5. Restart the server (or `uv run python -m app.db.migrate`), then `uv run pytest`.
6. Commit the model change and its migration together, and update the schema table above.

**Rules**
- Never edit or delete a migration that is on `main`; add a new one. Teammates' databases already ran the old version and would silently diverge. Editing your own unmerged migration is fine; reset your local DB afterwards.
- New columns on existing tables are nullable or have a `server_default`, so existing rows survive.
- Before merging a PR, merge `main` into your branch and run `uv run pytest`.
- Autogenerate needs review for: renames (it emits drop + add, which loses data; use `op.alter_column(..., new_column_name=...)` or `op.rename_table`), changed `server_default`s, CHECK constraints from `Enum(native_enum=False)`, and data backfills (`op.execute`). It handles expression indexes such as `lower(username)`.

**Protocols** — what happens on its own, and what (if anything) you do:

| Situation | Automatic | You do |
|---|---|---|
| Someone merged a migration | Applied on your next server start | Nothing |
| You changed a model without a migration | Startup logs "Models don't match the migrations"; `test_models_match_migrations` fails | Workflow steps 3–6 |
| Your branch and `main` both added a migration ("multiple heads") | Dev server applies both; `test_migrations_have_a_single_head` fails | Whoever merges second: `uv run alembic merge heads -m "merge"`, commit the file |
| Your DB has a migration this checkout lacks (you switched branches), or predates Alembic | With `APP_ENV=development`, startup wipes and rebuilds the local DB and logs it; otherwise it refuses to start and prints the reset command | Nothing; sign in again. To keep local data, run `uv run alembic downgrade <shared revision>` before switching branches |
| A migration fails partway | The whole upgrade rolls back; the server doesn't start | Fix the migration (it isn't on `main` yet) and restart |
| Local DB is in a strange state | — | `uv run python -m app.db.migrate --reset` (development only) |
| Production | Migrations run on startup; never auto-reset (`APP_ENV` unset) | Run one server process; concurrent startups would race on migrations |

The temporary topic importer lives in `app/db/seed.py`; ladder seeding is PLANNED.
From `backend/`, run `uv run python -m app.db.create_tables`, then
`uv run python -m app.db.seed topics.example.txt`.
New topics are active by default; pass `--inactive` to add inactive topics. Each UTF-8 line is
`category | topic | pro position | con position` (no embedded pipes); blank lines and `#` comments are ignored.
All fields must contain 1–255 characters. The whole file is validated before writing,
and imported in one transaction. Identical category/topic/position entries are skipped, including duplicates
within the file; existing rows are unchanged. Run one importer at a time, since the
model has no uniqueness constraint on topic content.
Code can call `await import_topics(session, path, is_active=True)` with a fresh session
and a `pathlib.Path`. `TopicRepository` provides add, ID/content lookup, and random
active-topic selection (returns `None` when none are active); callers own transactions.

For an existing `topics` table, apply this schema change before importing:

```sql
ALTER TABLE topics ADD COLUMN category VARCHAR(255) NOT NULL DEFAULT 'General';
```
