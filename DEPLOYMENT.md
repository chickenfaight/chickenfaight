# Deployment

Production checklist for the current implementation. No hosting provider, domain,
reverse-proxy configuration, or automatic rollout is supplied by this repository.
Choose and validate those before launch. Local setup is in
[CONTRIBUTING.md](CONTRIBUTING.md); automated checks are in [TESTING.md](TESTING.md).

## Topology and capacity

- Run **one backend process and one active backend instance**. Matchmaking,
  assignments, live engines, BILC connections, and rate limits are process-local.
  Sticky sessions alone do not make multiple instances safe. Disable overlapping
  rolling deployments and autoscaling until shared-state coordination exists.
- Run PostgreSQL on private networking with persistent storage, restricted access,
  backups, and a tested restore procedure. Configure transport encryption as
  required by the database host. Budget connections for the backend pool and
  migration/administrative jobs.
- Run the Next.js frontend with a Node server (`pnpm build`, then `pnpm start`),
  not a static export: authenticated pages use Server Components. Use the pinned
  pnpm version and Node version used by CI; install with the frozen lockfile.
- Size compute, disk, database, and inference quotas using concurrent matches,
  long-lived sockets, avatar storage, and pending-result growth. Configure budget
  alerts. Provider throttling/queues can cause match timeouts even with idle CPU.

## Public URLs, TLS, and the reverse proxy

- Provision DNS and valid HTTPS certificates; verify renewal and WSS connections.
  Keep backend/database ports private behind the proxy where possible.
- Prefer **one public origin**, routing `/auth/*` and `/v1/*` to the backend and
  other app routes to Next.js. Route backend health checks explicitly so they do
  not accidentally hit the frontend's separate `/health` page.
- The session cookie is currently host-only, HTTP-only, and SameSite=Lax.
  Frontend SSR forwards the incoming browser cookie to the backend. Separate
  frontend/API hostnames therefore require a deliberate cookie/proxy change:
  an API-only host cookie is absent on frontend requests, even if CORS allows
  browser API calls. Do not assume subdomains or unrelated domains work unchanged.
- Set `FRONTEND_URL` to the exact public frontend origin (scheme, hostname, port).
  It governs CORS, browser WebSocket Origin checks, and frontend redirects.
- Set `NEXT_PUBLIC_BACKEND_URL` **before building** the frontend. It must be an
  absolute URL reachable both by browsers and by the Next.js server; it is public,
  not a place for secrets. With a shared origin, use that public origin and ensure
  server-side traffic can reach it too. Rebuild when this value changes.
- Preserve Host and configure forwarded scheme/client-IP headers. Trust forwarded
  headers only from the actual proxy; prevent direct clients from spoofing them.
  Verify IP rate limits do not see every user as the load balancer.
- Enable WebSocket upgrades for match and BILC routes and allow long-lived
  connections. Idle/read timeouts must accommodate 15-second heartbeats, the
  120-second prompt window, and inference/judge waits; avoid proxy buffering of
  streamed responses (including the tips coach). Check provider/network timeouts
  against the engine limits in [PROTOCOL.md](PROTOCOL.md).

## Runtime configuration and secrets

Start from [backend/.env.example](backend/.env.example) and
[frontend/.env.example](frontend/.env.example); inject real values through the
hosting environment/secret store, never committed files or frontend variables.

| Backend setting | Production requirement |
|---|---|
| `APP_ENV` | Explicitly `production`; never `development`, which permits destructive local DB resets |
| `POSTGRES_URL` | Production PostgreSQL connection URL; protect credentials and configure host-required TLS |
| `SESSION_SECRET` | Strong, stable random secret; generate with `openssl rand -hex 32` |
| `BILC_JWT_SECRET` | Independent strong random secret generated the same way |
| `SECURE_COOKIES` | `true` with HTTPS |
| `FRONTEND_URL` | Exact public frontend origin |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Credentials for the production Google OAuth application |
| `INFERENCE_BASE_URL`, `INFERENCE_API_KEY` | Selected OpenAI-compatible provider and server-only key |
| `INFERENCE_JUDGE_MODEL` | Explicitly select and test a model supporting structured verdicts |
| `MATCH_RESULT_DIRECTORY` | Absolute path to persistent storage writable by the backend user |
| `BILC_MIN_SUPPORTED_VERSION` | Released compatible minimum; `dev` clients are rejected outside development |
| `BILC_RELEASES_URL` | Override only if releases come from a different repository |

Keep `TEST_POSTGRES_URL` and test credentials out of production jobs. Test utilities
wipe their test database; never run them against deployment data. Maintain secrets
across restarts; plan rotations because changing signing secrets invalidates
sessions or BILC access tokens.

Register the exact public `/auth/google/callback` URL in Google Cloud Console and
configure consent/publishing and authorized users/domains as appropriate. The
callback URL is derived from the incoming request, so proxy Host/scheme must be
correct. `GOOGLE_REDIRECT_URI` in the example file is **not read by the app**;
setting it alone does not configure the callback. Test the actual Google flow.
Review the source-controlled admin allowlist in `backend/app/auth/admins.py`.

## Database initialization and inference

1. Back up an existing database before an upgrade. Start only one backend:
   Alembic migrations run automatically before requests are accepted. A failed
   migration prevents startup; inspect logs rather than enabling development
   resets. Schema workflow and failure cases are in
   [BACKEND.md](backend/BACKEND.md#changing-the-schema).
2. After migrations, provision at least one active topic and the model/ladder
   catalogue. From `backend/`, with the intended deployment environment:

   ```bash
   uv run python -m app.db.seed topics.example.txt
   uv run python -m app.db.seed_models
   ```

   Review topics before making them active. `seed_models` provisions model ladders;
   `uv run python -m app.db.seed_ladders` repairs older catalogues. These are
   explicit administrative jobs, not automatic container startup steps.
3. Test the selected argument models and judge against the real provider. Catalogue
   selection does not guarantee a different provider serves the same model IDs.
   Never use `openrouter/free`. Confirm structured verdicts, terminal stream
   completion, available quotas, costs, concurrency, and failure handling. Recheck
   availability when importing models or changing provider configuration.

## Result journal, backups, and recovery

- Mount `MATCH_RESULT_DIRECTORY` on a **persistent filesystem supporting atomic
  rename and fsync**, retained across process/container replacement. The default
  `~/.local/share/chickenfaight/results` resolves under `/home/appuser` in the
  backend image; its container filesystem alone is not durable across replacement.
- Provision ownership for the non-root backend user. The app uses 0700 directories
  and 0600 files and checks directory preparation at startup. Test the real mount,
  permissions, available space, and durability; do not share it between processes.
- Decided results are journaled before acknowledgement, committed atomically to
  PostgreSQL, and removed after commit. A worker retries pending entries every
  5 seconds with a 10-second timeout per DB write. Replay is idempotent; a crash
  after commit but before removal does not award twice.
- During outages, verdicts can precede saved history. Monitor pending count/age,
  disk use, and replay errors. Invalid entries remain for investigation; do not
  blindly delete journals to clear alerts. Back up the journal alongside the DB
  and test coordinated restoration. Old DB backups plus already-cleared journals
  cannot reconstruct newer committed results.
- Recovery requires both retained journal storage and an available database. It
  does not recover unfinished matches, termination before journaling finishes,
  or lost/corrupt storage. Implementation details remain in
  [BACKEND.md](backend/BACKEND.md#durable-result-recovery).

## Releases

### Backend image

From `backend/`, bump versions using uv:

```bash
uv version --bump patch --no-sync
```

Commit both `pyproject.toml` and `uv.lock`. After review and CI, tag that commit
with its matching version and push the tag (example from repository root):

```bash
git tag backend/v0.1.0
git push origin backend/v0.1.0
```

The Build workflow runs reusable CI before publishing
`ghcr.io/chickenfaight/backend:0.1.0` for **linux/amd64**. Other architectures need
a separate build. Ordinary branch pushes and BILC tags do not publish backend
images. The workflow derives the image version from the tag; it does not check
agreement with the package version or deploy the image. Configure registry pull
access and record the immutable image digest used for each rollout.

### BILC distribution

Set the GitHub repository variable `BILC_SERVER_URL` to the production backend
HTTPS base URL before release; otherwise binaries default to localhost. From a
reviewed commit on `main` that passed CI:

```bash
git tag bilc/v0.1.0
git push origin bilc/v0.1.0
```

The BILC release workflow tests and publishes OS/architecture archives and
`checksums.txt` through GitHub Releases. Confirm the installer and backend
`/v1/bilc/releases/latest` resolve the intended compatible release. Coordinate the
minimum supported version with distribution so existing players can upgrade.
Checksums are implemented; signed releases/self-update remain planned. See
[BILC.md](bilc/BILC.md#updates) for the installer and update contract.

## Rollout, shutdown, and operations

- Run the backend image as its non-root user with one Uvicorn worker (the image
  default). Supply its DB/secrets/volume at runtime. `/health` is a liveness check
  only: it returns healthy without checking DB, model availability, or journal
  backlog. Add external dependency/functional checks for operational readiness.
- Schedule maintenance and stop new traffic before replacing the sole backend;
  there is no matchmaking drain endpoint. Existing queue/socket state is not
  transferred and browser reconnect snapshots remain planned. Do not overlap old
  and new instances or let BILC reconnect to a second instance during shutdown.
- Ensure SIGTERM reaches Uvicorn. Configure a measured shutdown grace period that
  allows cancellation, journaling, and cleanup; test it under DB failure and
  in-flight generation/judging. Shutdown awaits match workers and voids unfinished
  matches without replacing already decided outcomes. Forced termination before
  journaling remains a loss boundary.
- Start the replacement with the same retained journal volume and correct DB.
  Check migration logs, replay progress, and a real match before reopening traffic.
- Keep the previous image/config and a rollback plan. Older code may not support
  new schemas or journal formats; restarting an older image is not a guaranteed
  DB rollback. Prefer a compatible forward fix or a rehearsed coordinated restore.
- Collect logs/alerts for crashes, model failures, DB errors, journal failures,
  disk exhaustion, and migration failures. Redact cookies, tokens, pairing codes,
  credentials, and private prompts. Restrict journal/backup access and establish
  retention and incident ownership. Secure the host, registry, database, and
  deployment credentials; keep dependencies and certificates maintained.

## Launch verification in the target environment

Passing CI is necessary but does not verify the chosen host/proxy/provider.
Use staging and disposable data for destructive failure tests, then add a staging
smoke job once those resources exist:

- Run the full checks in [TESTING.md](TESTING.md). CI covers backend/browser/BILC
  tests, production-image imports/non-root execution, and release gates; pytest
  deliberately does not run the production lifespan or migrate a production DB.
- Verify HTTPS/WSS, certificates, cookie Secure/HTTP-only/SameSite behavior,
  authenticated hard reloads, OAuth consent/callback, logout, and CORS/Origin
  rejection through the actual public URLs. Check docs endpoints are disabled.
- Complete a real two-player cloud match with the selected models; verify streamed
  plain text, verdict, history, Elo, rewards, daily challenge, and no leaked prompts.
- Check cancellation/requeue, duplicate tabs, missing players, model/provider
  failure, and both browser and BILC connections through proxy idle timeouts.
- Against disposable deployment data, test container startup/migrations, SIGTERM
  during joining/generation/judging/reporting, DB outage/recovery, disk-write
  failure, abrupt process kill, and container replacement retaining the volume.
  Verify recovery does not duplicate history, rewards, or Elo.
- Exercise released BILC archives on macOS/Linux/Windows: real OS credential
  storage, installed Ollama reuse/ownership/signals, pairing/revocation/update
  checks, and two physical machines on different networks. Local fake-server
  tests do not establish these platform behaviors.
- Test database/journal restoration and confirm monitoring catches a stalled
  recovery queue or unavailable provider before opening general access.
