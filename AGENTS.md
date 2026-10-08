# Chicken fAIght — Agent Guide

Competitive debate platform: two players each write **one prompt** that steers an LLM through a debate; an **AI judge** picks the winner; players are ranked by **Elo, separately per model**. A **BYOM** arena lets users pit a model running on their own machine, connected through the **BILC** desktop client.

This file is the entry point. It is architectural only; details live in the linked docs.

## Required reading

Before changing anything in a row below, read the linked doc. If your change contradicts it, update the doc in the same change (or stop and ask). Docs are the source of truth; code that disagrees with them is a bug in one or the other.

| You are touching | Read first |
|---|---|
| Anything | this file, [CONTRIBUTING.md](CONTRIBUTING.md) |
| `frontend/` | [frontend/FRONTEND.md](frontend/FRONTEND.md) |
| `backend/` (API, DB, game engine) | [backend/BACKEND.md](backend/BACKEND.md) |
| `bilc/` | [bilc/BILC.md](bilc/BILC.md) |
| Any HTTP route, WebSocket message, or inference call | [PROTOCOL.md](PROTOCOL.md) |
| Tests | [TESTING.md](TESTING.md) |

Items tagged **PLANNED** in any doc are specified but not yet built. Build them as specified. When you implement one, delete its PLANNED tag in the same change (PROTOCOL.md instead marks shipped items "(implemented)").

## Repository layout

```
AGENTS.md          this file (CLAUDE.md imports it)
CONTRIBUTING.md    setup, branches, PRs
PROTOCOL.md        every contract between components
TESTING.md         test strategy per component
backend/           FastAPI server: REST API, matchmaking, game engine, DB access (Python, uv)
frontend/          Next.js web app (TypeScript, pnpm)
bilc/              PLANNED — BYOM Interface Layer Client (Go CLI)
```

## Components

- **Frontend web app** (`frontend/`): all player UI — login, game selection, live debate view, leaderboard, profile, BILC pairing. Talks to the server over REST and one WebSocket per match.
- **API server** (`backend/`): accounts, Google OAuth, sessions, matchmaking, Elo, persistence, BILC pairing/tokens. Spawns one game engine per match.
- **Game engine** (`backend/app/engine/`, partially built): runs one match — connects both players, collects prompts, alternates model turns, streams output, calls the judge, extracts the verdict, reports the result. Built so far: opening turns, judging, retries and void on model failure, and forfeit on resign; rebuttal/closing phases and persisting results/Elo remain PLANNED. Lives in the server process but is kept separate from general platform code.
- **BILC** (`bilc/`, PLANNED): Go CLI on the user's machine. Holds a persistent WebSocket to the server and forwards turn requests to the user's local OpenAI-compatible model.
- **Database**: PostgreSQL, accessed only through the backend.
- **External services**: Google OAuth; an OpenAI-compatible inference provider chosen by env: OpenRouter (the default) or Purdue GenAI Studio for development.

## Design decisions

| Decision | Choice | Why |
|---|---|---|
| Ranking | Elo | Predicts win probability; standard for 1v1 |
| Ranking scope | Separate Elo per model ("ladder") | Fairness; a stronger model can't inflate a rating |
| Winner | AI judge | Instant verdicts; tunable criteria |
| Prompts per match | One per player | Fast resolution |
| Frontend | Next.js + React Context + Tailwind | See FRONTEND.md |
| Backend | FastAPI, async SQLAlchemy, Pydantic | asyncio concurrency, OpenAI SDK support |
| Database | PostgreSQL; JSONB only for provider/model metadata | Relational core data, flexible metadata |
| Schema changes | Alembic migrations, applied on server startup | Local DBs stay in sync without coordination; see BACKEND.md |
| Inference | Any OpenAI-compatible provider, streamed; endpoint set by `INFERENCE_BASE_URL`; argument model selected from the database; judge set by `INFERENCE_JUDGE_MODEL` | OpenRouter for many models including free ones; GenAI Studio for development without OpenRouter's daily cap |
| Models | Database-selected argument model and independently configured judge, never `openrouter/free`; OpenRouter-only options sent only to OpenRouter | Random routing hit safety classifiers and reasoning models; other providers reject unknown options |
| Model failures | Retry a turn or verdict once, then void the match | The platform's fault, so no Elo change |
| Web sessions | Random token in a signed HTTP-only cookie; only its SHA-256 hash is stored server-side; 14 days; logout deletes it | Logout and expiry really end a session; `/auth/me` validates it |
| Public routes | Allowlist of 6 (`/health`, Google login/callback, password signup/login, logout), enforced by `tests/integration/test_route_auth.py`; API docs only in development | A new route can't ship public by accident |
| Rate limits | In-memory token buckets: per signed-in user on routes that read other users' data or edit friends; per IP and per tag on password sign-in and signup | Slows scraping and password guessing; one process, like matchmaking |
| Passwords | Sent as typed over HTTPS; the server stores a salted scrypt hash (stdlib); one generic error for every failed sign-in | A client-side hash would itself be the password; no account enumeration |
| Friends | One-way adds; each list visible only to its owner | No approval flow; no scraping friend graphs |
| Match concurrency | One asyncio task per match (the design doc's "thread") | No OS threads in an async server |
| Live output | Provider → server via SSE; server → browser/BILC via WebSocket | Players watch the debate stream |
| BILC language | Go, static binaries | Goroutines/timeouts, cross-platform |

## Glossary

Use these terms exactly, in code and docs.

- **match** — one debate between two players. Use "debate" only in UI copy.
- **tag** — a user's permanent unique identifier (`users.tag`), set once. Used in URLs, search, and password sign-in.
- **username** — a user's changeable display name (`users.username`); not unique. Never use it to identify a user.
- **player** — a user in a match; each is assigned a **side**: `pro` or `con`.
- **turn** — one model generation for one side in one **phase** (`opening`, `rebuttal`, `closing`).
- **ladder** — a model's separate Elo pool; the BYOM arena is one ladder.
- **judge** — the server-chosen model that returns the verdict.
- **BILC** — the BYOM Interface Layer Client. Not "proxy", "runner", or "desktop app".
- **engine** — the game engine for one match.

## Guardrails (do not)

- Do not trust anything from a client, a player prompt, or model output. Player prompts and all model output (especially BYOM) are untrusted text.
- Do not let a player prompt reach a model except through the engine's `format_game` wrapper. Do not show player prompts to the judge.
- Do not render model output as HTML or Markdown. Plain text only.
- Do not add a route, WebSocket message, or field that is not in PROTOCOL.md; add it there first.
- Do not add an endpoint without deciding its auth. Default is authenticated. A public route must go in PROTOCOL.md and the allowlist in `test_route_auth.py`; a route exposing other users' data needs a rate limit (`app/api/rate_limit.py`).
- Do not put secrets in code, logs, or commits. Config comes from env via `backend/app/config.py`; only `.env.example` is committed.
- Do not log tokens, cookies, pairing codes, or full prompts.
- Do not store tokens or codes in plaintext; store hashes.
- Do not build SQL with string formatting; use SQLAlchemy.
- Do not change a model without a reviewed Alembic migration in the same change, and never edit a migration that is already on `main` (BACKEND.md, "Changing the schema").
- Do not add dependencies, frameworks, or UI libraries without a reason stated in the PR.
- Do not call an inference provider outside `backend/app/inference/`. Do not hard-code model IDs or provider URLs; read them from `settings`.
- Do not run the app's startup in tests (`with TestClient(app)`, or calling `lifespan`): it migrates, and in development may reset, the real database in `POSTGRES_URL`.
- Do not hand-edit the block between the `nextjs-agent-rules` markers in `frontend/AGENTS.md`.
- Do not create new top-level docs; extend the existing ones and keep them short.
