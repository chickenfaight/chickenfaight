# Contributing

Read [AGENTS.md](AGENTS.md) first. Its "Required reading" table and guardrails apply to every change, whether a human or an LLM writes it.

## Setup

Prerequisites: Python ≥ 3.14, [uv](https://docs.astral.sh/uv/), Node.js LTS, pnpm, PostgreSQL. For `bilc/` and the BYOM arena only: Go (the version in `bilc/go.mod`) and [Ollama](https://ollama.com).

**Database**

```bash
createdb chickenfaight
createdb chickenfaight_test   # for `uv run pytest`; tables are created by the tests
```

**Backend** (http://localhost:8000)

```bash
cd backend
cp .env.example .env        # fill in Postgres credentials, Google OAuth, SESSION_SECRET, BILC_JWT_SECRET, INFERENCE_API_KEY
uv run fastapi dev app/main.py
```

`uv run` installs dependencies from `uv.lock`, and startup applies database migrations, so this one command is also how you catch up after every `git pull`. If startup reports a reset or a schema problem, see "Changing the schema" in [backend/BACKEND.md](backend/BACKEND.md).

Google OAuth: create an OAuth 2.0 Web client in Google Cloud Console with redirect URI `http://localhost:8000/auth/google/callback`. Generate `SESSION_SECRET` and `BILC_JWT_SECRET` (a different value) each with `openssl rand -hex 32`. Startup fails without them.

The judge must be a free OpenRouter model that supports structured outputs, and OpenRouter's free list changes. If every match is voided with "the judge failed" and the log shows a 404 such as "This model is unavailable for free", set `INFERENCE_JUDGE_MODEL` in `.env` (e.g. `nvidia/nemotron-3.5-super-vl:free`) and restart. To find candidates, look for `:free` models whose `supported_parameters` include `structured_outputs` at https://openrouter.ai/api/v1/models.

`BILC_MIN_SUPPORTED_VERSION` (optional, default `0.1.0`) refuses older BILC clients. Locally built BILC reports version `dev`, which is accepted only with `APP_ENV=development`.

**Debate topics**

Matches need at least one active topic; with none, a match fails with "No active topic found". Migrations create an empty `topics` table, so load topics once after setup, and again whenever your local database is reset:

```bash
cd backend
uv run python -m app.db.seed topics.example.txt
```

Each line of the file is `category | topic | pro position | con position`; `#` lines and blank lines are ignored. Re-running is safe: topics already in the database are skipped. Add `--inactive` to load topics that won't be picked for matches yet. Details are in [backend/BACKEND.md](backend/BACKEND.md), under "Changing the schema".

**Free OpenRouter models**

After migrations have run, populate the model catalogue from OpenRouter:

```bash
cd backend
uv run python -m app.db.seed_models
```

Re-running updates existing models without duplicates. All imported models belong
to a single provider row with slug `openrouter`; model authors are not providers.
See [backend/BACKEND.md](backend/BACKEND.md) for filtering and update behavior.

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

## BILC

Run BILC from source, with the backend and frontend running. Get `<code>` from http://localhost:3000/bilc; the server defaults to http://localhost:8000.

```bash
ollama pull llama3.2:3b     # llama3.2:1b often refuses to argue; try 3B or larger
cd bilc
unset BILC_CONFIG_DIR      # first device uses the default config directory
go run ./cmd/bilc pair <code>
go run ./cmd/bilc model set --model llama3.2:3b
go run ./cmd/bilc run       # leave running; the BILC page shows the device online
```

**Two sessions on one machine (macOS and Linux).** A BYOM match needs two players, each with a separately paired device. `BILC_CONFIG_DIR` overrides the entire BILC config directory with an absolute path. On macOS, the default is `~/Library/Application Support/chickenfaight/bilc`; `XDG_CONFIG_HOME` has no effect. Use `BILC_CONFIG_DIR` for the second device on either OS.

Sign up a second account in a private window, get a fresh pairing code there, and in a second terminal run from the repository root:

```bash
cd bilc
export BILC_CONFIG_DIR="$HOME/.bilc-b" # only this terminal; keep it set for every bilc command here
go run ./cmd/bilc pair <code> --name device-b
go run ./cmd/bilc model set --model llama3.2:3b
go run ./cmd/bilc run
```

Leave `BILC_CONFIG_DIR` unset in the first terminal. When reopening the second terminal later, export the same path again before running BILC. Pair it separately; copying the first device's config would reuse its identity. Both devices can use macOS Keychain because tokens are stored under distinct device IDs.

Both sessions can share one Ollama and model. Pick **Bring your own model** in both windows and join. To clean up, stop both runs and run `go run ./cmd/bilc unpair` in each terminal, with the variable still set in the second, since that also removes its keychain entry. Then remove `~/.bilc-b` if no longer needed, run `unset BILC_CONFIG_DIR` in the second terminal, and Revoke both devices on the BILC page.

The commands above use the current source. If using `./bilc` instead, rebuild it after pulling this fix with `go build -o bilc ./cmd/bilc` from `bilc/`; an older binary will ignore the new variable.

Credentials go in the system keychain, or `credentials.json` (mode 0600) in the config directory when there is none. Run `go test -race ./...` from `bilc/` before a PR; [TESTING.md](TESTING.md) has the full checks.

To release, tag a commit on `main` that passed CI and push the tag: `git tag bilc/v0.1.0 && git push origin bilc/v0.1.0`. The `BILC release` workflow builds the binaries and publishes a GitHub Release, which `bilc/install.sh` installs from. Set the repository variable `BILC_SERVER_URL` once the server is deployed, so release builds default to it.

## Backend image releases

From `backend/`, increment the version with uv instead of editing version files manually:

```bash
uv version --bump patch --no-sync
```

Use `--bump minor` or `--bump major` for larger releases, or `uv version 0.1.0 --no-sync`
to set an exact version. These commands update both `pyproject.toml` and `uv.lock`;
`--no-sync` skips installing dependencies locally. Commit both files and push the
commit. After CI passes, tag that commit with the same version and push the tag
(for example, if uv set the version to `0.1.0`):

```bash
git tag backend/v0.1.0
git push origin backend/v0.1.0
```

The `Build` workflow builds `backend/Dockerfile` and pushes a
Linux amd64 image to `ghcr.io/chickenfaight/backend:0.1.0`.
Tags must use `backend/vMAJOR.MINOR.PATCH`. Ordinary branch pushes and `bilc/v*` tags do not
publish backend images. Keep the version in `pyproject.toml` and `uv.lock` consistent
with the Git tag: version `0.1.0` uses `backend/v0.1.0` and publishes image tag `0.1.0`.
The workflow derives the image version from the Git tag; it does not check version
agreement or CI results, or deploy the image.
