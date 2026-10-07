# Contributing

Read [AGENTS.md](AGENTS.md) first. Its "Required reading" table and guardrails apply to every change, whether a human or an LLM writes it.

## Setup

Prerequisites: Python ≥ 3.14, [uv](https://docs.astral.sh/uv/), Node.js LTS, pnpm, PostgreSQL. Go is needed only for `bilc/`.

**Database**

```bash
createdb chickenfaight
createdb chickenfaight_test   # for `uv run pytest`; tables are created by the tests
```

**Backend** (http://localhost:8000)

```bash
cd backend
cp .env.example .env        # fill in Postgres credentials, Google OAuth, SESSION_SECRET, INFERENCE_API_KEY
uv run fastapi dev app/main.py
```

`uv run` installs dependencies from `uv.lock`, and startup applies database migrations, so this one command is also how you catch up after every `git pull`. If startup reports a reset or a schema problem, see "Changing the schema" in [backend/BACKEND.md](backend/BACKEND.md).

Google OAuth: create an OAuth 2.0 Web client in Google Cloud Console with redirect URI `http://localhost:8000/auth/google/callback`. Generate `SESSION_SECRET` with `openssl rand -hex 32`.

**Debate topics**

Matches need at least one active topic; with none, a match fails with "No active topic found". Migrations create an empty `topics` table, so load topics once after setup, and again whenever your local database is reset:

```bash
cd backend
uv run python -m app.db.seed topics.example.txt
```

Each line of the file is `category | topic | pro position | con position`; `#` lines and blank lines are ignored. Re-running is safe: topics already in the database are skipped. Add `--inactive` to load topics that won't be picked for matches yet. Details are in [backend/BACKEND.md](backend/BACKEND.md), under "Changing the schema".

**Frontend** (http://localhost:3000)

```bash
cd frontend
cp .env.example .env.local
pnpm install
pnpm dev
```

Check the connection at http://localhost:3000/health.

## Branches and PRs

- Branch per user story: `us-<number>` (e.g. `us-16`), from `main`.
- Open a PR into `main` that names the user story and its tasks. There is no required reviewer; ask a teammate when a change is risky.
- Before opening a PR, confirm:
  - The change follows AGENTS.md guardrails and the doc for each area touched.
  - Any doc made wrong by the change is updated in the same PR: contracts in PROTOCOL.md, schema in BACKEND.md, structure/style in FRONTEND.md or BILC.md.
  - PLANNED tags are removed for anything the PR implements.
  - Model changes include a reviewed Alembic migration; no merged migration was edited (see BACKEND.md).
  - `main` is merged into the branch and `uv run pytest` passes (it fails on missing or unmerged migrations).
  - Tests per TESTING.md pass, and UI changes were used in a browser.
  - No secrets, `.env` files, or generated files (`.next/`, `.venv/`, `__pycache__/`) are committed.
