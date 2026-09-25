# Backend

FastAPI server: REST API, matchmaking, game engine, persistence. Contracts are in [PROTOCOL.md](../PROTOCOL.md); tests in [TESTING.md](../TESTING.md).

## Stack

Python ≥ 3.14 managed with `uv`; FastAPI; SQLAlchemy 2 async + psycopg 3; Pydantic; Authlib (Google OIDC); PostgreSQL. PLANNED additions: `openai` (inference client), `PyJWT` (BILC tokens).

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
  db/             base.py, session.py, create_tables.py, seed.py (PLANNED)
```

Dependency direction: `api → services → repositories → models`. `engine` uses `services` and `inference`; nothing imports `api`. Split `schemas/schemas.py` into per-domain files as it grows, re-exported from `schemas/__init__.py`.

Rules:
- Routers declare `response_model` (or a return type) and never return ORM objects.
- Services open transactions with `async with self.session.begin():` (see `UserService`).
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

## Matchmaking and Elo

- One queue per ladder. Pair the two closest-rated players within ±100 Elo; the window widens by 50 every 10 s waited. BYOM players queue only with an online, idle device.
- Elo per `(user, ladder)`: start 1000, K = 32, expected score `1 / (1 + 10^((Rb − Ra)/400))`. Forfeits update Elo as losses; voids don't. Update both ratings in the same transaction as the match result.

## Database schema (target)

Postgres. Integer PKs unless noted. Every table has `created_at` (`DateTime(timezone=True)`, `server_default=func.now()`). Enumerated values are Python `StrEnum`s stored with `Enum(..., native_enum=False)` (VARCHAR + CHECK) so they can change without Postgres enum migrations.

| Table | Columns | Notes |
|---|---|---|
| `users` (implemented) | `id`, `google_sub` unique, `email?`, `username?` unique, `avatar_url?`, `updated_at` | Drop `elo` when `ratings` ships; `username` unique is PLANNED |
| `ladders` | `id`, `slug` unique, `display_name`, `kind` (`cloud`/`byom`), `provider_model_id?`, `is_active`, `provider_metadata` JSONB | Exactly one `byom` row |
| `ratings` | PK(`user_id`, `ladder_id`), `elo` = 1000, `games_played`, `wins`, `losses`, `updated_at` | Created on first queue |
| `topics` | `id`, `text`, `is_active` | |
| `matches` | `id`, `ladder_id`, `topic_id`, `status`, `winner_side?`, `end_reason?`, `verdict_reasoning?`, `judge_metadata` JSONB, `started_at?`, `ended_at?` | |
| `match_participants` | PK(`match_id`, `side`), `user_id` (unique with `match_id`), `bilc_device_id?`, `prompt?`, `elo_before`, `elo_after?` | `prompt` never exposed to others |
| `turns` | `id`, `match_id`, `index` (unique with `match_id`), `side`, `phase`, `content`, `truncated`, `usage` JSONB | Written as each turn ends |
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

There is no migration tool. `app/db/create_tables.py` creates missing tables and never alters existing ones.

1. Edit or add the model in `app/models/`, and export it from `app/models/__init__.py` (unexported models are not created).
2. Update the schema table above.
3. Apply it:
   - **New table:** `uv run python -m app.db.create_tables`.
   - **Changing an existing table:** write the `ALTER TABLE ...` SQL in the PR description under "Schema change". Everyone applies it by hand with `psql`, or resets their local DB. New columns must be nullable or have a `server_default` so existing rows survive.
4. Reset a local DB: `dropdb chickenfaight && createdb chickenfaight && uv run python -m app.db.create_tables` (then `uv run python -m app.db.seed` once it exists).

Seed data (ladders, topics) lives in `app/db/seed.py` (PLANNED) and must be idempotent.
