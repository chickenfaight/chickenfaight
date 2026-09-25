# Contributing

Read [AGENTS.md](AGENTS.md) first. Its "Required reading" table and guardrails apply to every change, whether a human or an LLM writes it.

## Setup

Prerequisites: Python ≥ 3.14, [uv](https://docs.astral.sh/uv/), Node.js LTS, pnpm, PostgreSQL. Go is needed only for `bilc/`.

**Database**

```bash
createdb chickenfaight
```

**Backend** (http://localhost:8000)

```bash
cd backend
cp .env.example .env        # fill in Postgres credentials, Google OAuth, SESSION_SECRET
uv sync
uv run python -m app.db.create_tables
uv run fastapi dev app/main.py
```

Google OAuth: create an OAuth 2.0 Web client in Google Cloud Console with redirect URI `http://localhost:8000/auth/google/callback`. Generate `SESSION_SECRET` with `openssl rand -hex 32`.

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
  - Schema changes to existing tables include their SQL (see BACKEND.md).
  - Tests per TESTING.md pass, and UI changes were used in a browser.
  - No secrets, `.env` files, or generated files (`.next/`, `.venv/`, `__pycache__/`) are committed.
