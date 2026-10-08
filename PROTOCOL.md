# Protocol

The single source of truth for every contract between components. Server, frontend, and BILC must match this file. Change it first, then the code, in the same PR.

Everything here is PLANNED unless marked **(implemented)**. Remove a PLANNED status by marking the item (implemented) when it ships.

## Channels

| From → To | Transport | Auth |
|---|---|---|
| Web → Server | REST | Session cookie |
| Web ↔ Engine | WebSocket, one per match | Session cookie |
| BILC → Server | REST | Pairing code / refresh token |
| BILC ↔ Server | WebSocket, one per device | Bearer access JWT |
| Server → cloud provider | OpenAI Chat Completions, SSE stream | Provider API key (env) |
| BILC → local model | OpenAI Chat Completions, SSE stream | None (localhost) |

## Conventions

- **API host.** The backend is deployed on a dedicated hostname (e.g. `https://api.domain.com`); paths below are relative to that origin and have no `/api` prefix.
- **Versioning.** Versioned REST routes live under `/v1`; `/health` and `/auth/*` remain unversioned. WebSockets carry an integer `protocol_version` (currently `1`) in their first message. Additive optional fields do not bump versions; anything else bumps `protocol_version` and, for REST, adds `/v2` next to `/v1`. The server supports the current and previous version. BILC also sends its semver `client_version`; the server rejects versions below `min_supported_version`.
- **Receivers ignore unknown fields.** Unknown WebSocket `type` → reply `ERROR` `UNKNOWN_TYPE`; do not close.
- **JSON** everywhere, `snake_case` keys, timestamps ISO 8601 UTC strings, UUID IDs everywhere (serialized as strings).
- **Default auth is required.** Rows marked `public` are the only exceptions.
- **REST errors** use one envelope, compatible with FastAPI's `detail`:
  `{ "code": str, "detail": str }`. Validation failures add `errors: list`. Existing `/auth` routes still return FastAPI's default `{ "detail": str }` until a global exception handler is added.

### Error codes

| Code | HTTP | WS close | Meaning |
|---|---|---|---|
| `UNAUTHENTICATED` | 401 | 4401 | No/expired session or JWT |
| `FORBIDDEN` | 403 | 4403 | Authenticated but not allowed (not a participant, revoked device) |
| `NOT_FOUND` | 404 | — | Missing, or hidden from this user |
| `VALIDATION_ERROR` | 422 | — | Bad request body/params |
| `BAD_MESSAGE` | — | — | WS message failed validation (no close) |
| `UNKNOWN_TYPE` | — | — | Unrecognized WS `type` (no close) |
| `ALREADY_QUEUED`, `IN_MATCH` | 409 | — | Matchmaking conflicts |
| `USERNAME_INVALID` | 422 | — | Tag breaks the format rule (implemented) |
| `USERNAME_NOT_ALLOWED` | 422 | — | Tag fails the profanity filter (implemented) |
| `USERNAME_TAKEN` | 409 | — | Tag already used by someone, ignoring case (implemented) |
| `USERNAME_ALREADY_SET` | 409 | — | Caller already has a tag; tags never change (implemented) |
| `USERNAME_REQUIRED` | 403 | — | Caller must set a tag first (implemented) |
| `BILC_OFFLINE`, `BILC_BUSY` | 409 | — | BYOM device can't take a match |
| `PAIRING_CODE_INVALID` | 400 | — | Wrong, used, or expired pairing code |
| `TOKEN_INVALID` | 401 | — | Bad/reused refresh token (reuse revokes the device) |
| `UNSUPPORTED_VERSION` | 426 | 4426 | `protocol_version` not supported |
| `BILC_OUTDATED` | 426 | 4426 | `client_version` < `min_supported_version` |
| `PROMPT_ALREADY_SUBMITTED`, `PROMPT_TOO_LONG` | — | — | Prompt rejected (no close) |
| `MODEL_UNAVAILABLE`, `MODEL_ERROR`, `MODEL_TIMEOUT` | — | — | Sent by BILC about the local model |
| `HEARTBEAT_TIMEOUT` | — | 4408 | No message within the timeout |
| `REPLACED` | — | 4409 | A newer connection for the same user+match or device |
| `FRIEND_SELF` | 422 | — | Players can't add themselves as friends (implemented) |
| `RATE_LIMITED` | 429 | — | Too many requests; the response carries a `Retry-After` header in whole seconds (implemented) |
| `INTERNAL` | 500 | 1011 | Server fault; never include internals in `detail` |

### Limits and timings

Server-side constants; clients read deadlines from messages rather than hard-coding them.

| Item | Value |
|---|---|
| Player prompt | ≤ 2000 chars |
| Turn output | `max_tokens` 400; server truncates at 4000 chars |
| Join deadline (after match created) | 30 s |
| Prompt deadline (after both joined) | 120 s |
| Turn: first token / total | 30 s / 90 s |
| Judge total | 120 s |
| Heartbeat interval / timeout | 15 s / 45 s |
| Queue poll interval | 2 s |
| Pairing code TTL | 10 min, single use |
| BILC access JWT / refresh token | 15 min / 30 days, rotated on every use |
| Web session (implemented) | 14 days from sign-in, not extended by use; logout ends it immediately |
| REST rate limits, per user (implemented) | Token buckets, each holding a burst and refilling steadily: search, profile lookup, tag availability, and friends list each allow a burst of 20 and 60/min; adding and removing friends share a burst of 10 and 20/min |

Rate limits apply per signed-in user, on routes that read other users' data or change the friends list. They're held in server memory, so they reset when the server restarts.

## Shared types

```
UserRead         { id: uuid, email: str|null, username: str|null, avatar_url: str|null, elo: int }   (implemented; elo is removed when Rating ships; username is the user's tag, null until set)
UserPublic       { id: uuid, username: str|null, avatar_url: str|null }   (implemented)
UserProfile      UserPublic + { ratings: [Rating], is_friend: bool }   (implemented; `ratings` is empty until ratings ship; `is_friend` is whether the caller has added this player)
Rating           { ladder: str, elo: int, games_played: int, wins: int, losses: int }
Ladder           { slug: str, display_name: str, kind: "cloud"|"byom" }
ArenaRead        { id: uuid, display_name: str, kind: "provided"|"byom" } (implemented; id is the model's UUID; kind currently defaults to "provided")
Side             "pro" | "con"
Phase            "opening" | "rebuttal" | "closing"
MatchStatus      "waiting_for_players" | "awaiting_prompts" | "in_progress" | "judging"
               | "completed" | "forfeited" | "voided"
EndReason        "judged" | "no_show" | "no_prompt" | "resigned" | "model_failure" | "judge_failure"
Participant      { side: Side, user: UserPublic, elo_before: int, elo_after: int|null }
Turn             { id: uuid, index: int, side: Side, phase: Phase, content: str }
MatchSummary     { id: uuid, ladder: str, topic: str, status: MatchStatus, winner_side: Side|null,
                   participants: [Participant], ended_at: str|null }
MatchRead        MatchSummary + { end_reason: EndReason|null, verdict_reasoning: str|null, turns: [Turn] }
BilcDevice       { id: uuid, name: str, platform: str, client_version: str, model_name: str|null,
                   online: bool, last_seen_at: str|null, created_at: str }
```

Player prompts are never returned by any endpoint or message except to their author.

## REST — web client

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/health` | public | — | `{ status: "healthy" }` (implemented) |
| GET | `/auth/google/login` | public | — | 302 to Google (implemented) |
| GET | `/auth/google/callback` | public | OAuth params | 302 to `FRONTEND_URL`; starts a server-side session and sets the session cookie (implemented) |
| GET | `/auth/me` | session | — | `UserRead`. This is how clients validate a stored session: 401 if the cookie is missing, forged, expired, or logged out (implemented) |
| POST | `/auth/logout` | public | — | 204; deletes the session server-side, so a copy of the old cookie stops working, and clears the cookie (implemented) |
| PATCH | `/v1/users/me` | session | `{ username: str }` (3–24 chars, `[a-zA-Z0-9_]`, unique) | `UserRead` |
| GET | `/v1/users/username-availability` | session | `?username=` (≤ 64 chars) | `{ available: bool, code: str\|null, detail: str\|null }`; `code` is one of the `USERNAME_*` errors above when unavailable (implemented) |
| GET | `/v1/users/search` | session | `?q=` (1–64 chars), `?limit=` (1–50, default 20), `?offset=` (≥ 0, default 0) | `{ items: [UserPublic], next_offset: int\|null }`; only users with a tag; ranked exact tag, then prefix, then contains, then fuzzy (trigram word similarity), all ignoring case; `next_offset` is null on the last page; a blank `q` returns no items (implemented) |
| GET | `/v1/users/by-username/{username}` | session | `{username}`: tag, ignoring case | `UserProfile`; 404 `NOT_FOUND` if no user has that tag (implemented) |
| GET | `/v1/users/{id}` | session | `{id}: uuid` | `UserProfile` |
| GET | `/v1/users/{id}/matches` | session | `{id}: uuid`, `?limit&offset` | `[MatchSummary]`, finished only |
| GET | `/v1/friends` | session | `?limit=` (1–100, default 50), `?offset=` (≥ 0, default 0) | `{ items: [UserPublic], next_offset: int\|null }`: the caller's own friends only, ordered by tag ignoring case. No route lists another player's friends (implemented) |
| PUT | `/v1/friends/{user_id}` | session | `{user_id}: uuid` | 204, also if already a friend. Adding is one-way; the other player doesn't approve it. 404 `NOT_FOUND` if no tagged player has that ID; 422 `FRIEND_SELF` for the caller's own ID (implemented) |
| DELETE | `/v1/friends/{user_id}` | session | `{user_id}: uuid` | 204, also if not a friend (implemented) |
| GET | `/v1/ladders` | session | — | `[Ladder]` (active only) |
| GET | `/v1/arenas` | session | — | `[ArenaRead]` (active models only; implemented) |
| GET | `/v1/ladders/{slug}/leaderboard` | session | `?limit&offset` | `[{ rank, user: UserPublic, rating: Rating }]` |
| POST | `/v1/matchmaking/queue` | session | `{ ladder: str, bilc_id?: uuid }` (`bilc_id` required iff ladder is BYOM, must be caller's online idle device) | 202 `{ status: "queued" }` |
| GET | `/v1/matchmaking/queue` | session | — | `{ status: "none"|"queued"|"matched", match_id?: uuid }` |
| DELETE | `/v1/matchmaking/queue` | session | — | 204 |
| GET | `/v1/matches/{id}` | session | `{id}: uuid` | `MatchRead`; live matches visible to participants only |
| POST | `/v1/matches/{id}/votes` | session | `{id}: uuid`, `{ side: Side }` | 204; finished matches, non-participants, one vote per user (upsert) |
| POST | `/v1/bilc/pairing-codes` | session | — | `{ code: str (8 chars, A–Z 2–9), expires_at }` |
| GET | `/v1/bilc/devices` | session | — | `[BilcDevice]` (caller's only) |
| DELETE | `/v1/bilc/devices/{id}` | session | `{id}: uuid` | 204; revokes tokens, closes its socket 4403 |

`/health` and `/auth/*` stay unversioned: the OAuth redirect URI is registered with Google.

The four `public` rows above are the only routes reachable without a session; `tests/integration/test_route_auth.py` enforces this for every route. FastAPI's `/docs`, `/redoc`, and `/openapi.json` exist only when `APP_ENV=development` (implemented).

### Current matchmaking integration

The current session-authenticated `POST /v1/match/queue` requires `{ model_id: uuid }` from `GET /v1/arenas`; an unknown or inactive model returns 404 `NOT_FOUND`, and malformed input returns 422. It returns HTTP 202 queue status. `GET /v1/match/status` returns HTTP 200 queue status. Both return `{ status: "none"|"queued"|"matched", match_id?: uuid }`. Matchmaking uses independent FIFO queues keyed by model UUID. The matchmaker passes the selected model UUID to the engine, which resolves its exact `api_model_id` and display name before inference. The client still uses the configured OpenRouter base URL and API key; provider-specific connection settings remain pending. The frontend integration is implemented: the lobby loads the arena catalog, displays model names, and sends the selected UUID in the required body. Selection stays locked during queue operations; recovered queues have an unknown model until `MATCH_STATE` arrives. Catalog failures do not block queue cancellation. `POST /v1/match/queue` returns 403 `USERNAME_REQUIRED` until the caller has a tag. `DELETE /v1/match/queue` (session, no body) cancels the caller’s queue entry in its selected model queue and returns HTTP 204, including if already absent; an existing match returns HTTP 409 `IN_MATCH`. The versioned routes above remain the target contract. The lobby polls until matched, then navigates to `/match/[match_id]`, where the arena opens the match WebSocket.

## REST — BILC

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/v1/bilc/register` | pairing code in body | `{ pairing_code, device_name, platform, client_version }` | `{ bilc_id: uuid, refresh_token: str }` |
| POST | `/v1/bilc/token` | refresh token in body | `{ bilc_id, refresh_token }` | `{ access_token, expires_at, refresh_token }` |
| GET | `/v1/bilc/releases/latest` | public | — | `{ version, min_supported_version, protocol_version, assets: [{ platform, arch, url, sha256 }] }` |
| GET | `/v1/bilc/download` | public | `?platform=mac|win|linux&arch=amd64|arm64` | 302 to the release asset |

Access JWT: HS256 with `BILC_JWT_SECRET`, claims `sub` = `bilc_id` (uuid), `uid` = user id (uuid), `aud` = `"bilc"`, `exp`. Presenting an already-rotated refresh token revokes the device.

## WebSocket envelope

Every frame, both directions, both sockets:

```
{ "type": str, "payload": object }
```

Heartbeat (both sockets): the server sends `HEARTBEAT { ts }` every interval; the client echoes it unchanged. Either side closes with 4408 after the timeout with no frames received. Only one socket per user+match (web) or per device (BILC); a new one closes the old with 4409.

## WebSocket — match (web ↔ engine)

`GET /v1/game/{match_id}/ws` (`{match_id}: uuid`), session cookie (implemented). Server closes 4401 if unauthenticated, 4403 if not a participant. The arena opens the socket after navigation on `matched`; reconnect snapshots remain planned.

| Type | Direction | Payload |
|---|---|---|
| `JOIN` | client → server | `{ protocol_version: int }` — must be first |
| `MATCH_STATE` | server → client | `{ match_id: uuid, ladder, topic, status: MatchStatus, you: Side, participants: [Participant], ready: [Side], deadline: str|null, turns: [Turn] }` — sent after every `JOIN` (full snapshot for reconnects) |
| `SUBMIT_PROMPT` | client → server | `{ prompt: str }` — once per match |
| `PLAYER_READY` | server → client | `{ side: Side }` — a player's prompt was accepted (PLANNED; the current engine does not emit a readiness notification) |
| `TURN_START` | server → client | `{ turn_id: uuid, index, side, phase }` |
| `TURN_DELTA` | server → client | `{ turn_id: uuid, delta: str }` |
| `TURN_END` | server → client | `{ turn_id: uuid, truncated: bool }` |
| `JUDGING` | server → client | `{}` — sent to both connected players after argument generation finishes, immediately before the judge call (implemented) |
| `MATCH_RESULT` | server → client | `{ status, winner_side: Side|null, end_reason: EndReason, verdict_reasoning: str|null, participants: [Participant] }` — server then closes 1000 |
| `RESIGN` | client → server | `{}`; forfeits the sender's side if no result is decided yet, otherwise ignored (implemented) |
| `HEARTBEAT` | both | `{ ts }` |
| `ERROR` | server → client | `{ code, message }` |

Current prompt readiness and generation (implemented): after both player sockets are connected, the engine sends its initial state and runs one generation task per side. Each task waits only for its own player's accepted `SUBMIT_PROMPT`, then immediately generates that side's opening argument without waiting for the opponent's prompt. The two generations can overlap. Judging waits until both arguments finish. The current engine does not require a `JOIN` message; the handshake and full snapshot above remain planned.

### Current arena wire format (implemented)

Until the full snapshot/turn contract above ships, the arena uses these payloads:

- `MATCH_STATE`: `{ match_id, model_display_name, topic: { category, topic, pro_position, con_position }, you, participants: [{ user_id, side }], deadline }`. `model_display_name` is the selected model's database display name. `deadline` is an ISO UTC timestamp, established once both players connect using the server's 120-second prompt window.
- `TURN_DELTA`: `{ delta }`, sent only to the author of the generating side.
- `TURN_END`: `{}`, sent to that same player once their opening argument finishes.
- `MATCH_RESULT`: `{ winner: "pro"|"con"|null, reason, status: "completed"|"forfeited"|"voided", end_reason: "judged"|"no_prompt"|"resigned"|"model_failure"|"judge_failure", arguments: { pro, con } }`. Only generated arguments are shared; player prompts remain private. A missed prompt deadline forfeits to the side that submitted; if neither submitted, the match is void. A cloud turn that errors or times out (30 s to first token, 90 s total) is retried once, unless part of it already streamed to the player, since a retry would duplicate that text; if it still fails, the match is void (`model_failure`), even if a prompt deadline also passed. A judge error, timeout (120 s), or unparseable verdict is retried once, then voids the match (`judge_failure`). `RESIGN` before any result stops generation or judging and forfeits to the other side (`resigned`); the first decided result is final. Once a match has a result, `GET /v1/match/status` stops reporting it as `matched`. These outcomes do not yet persist results or update Elo.
- `ERROR` also includes `PROMPT_DEADLINE_PASSED` when a submission arrives after the server deadline.

The browser retains `model_display_name` from `MATCH_STATE` and displays it throughout composition, generation, judging, and results (implemented). It echoes heartbeats, retains its submitted prompt in page memory, marks its argument complete on `TURN_END`, and changes the waiting message on `JUDGING`. Reload/reconnect recovery remains planned.

Disconnecting after submitting a prompt does not affect the match; turns keep running.

## WebSocket — BILC

`GET /v1/bilc/ws`, header `Authorization: Bearer <access_token>`. The server tracks each device as online/idle/busy from this socket.

| Type | Direction | Payload |
|---|---|---|
| `HELLO` | BILC → server | `{ protocol_version, client_version, platform, model: { name: str, context_length: int|null, metadata: object } }` — must be first |
| `HELLO_ACK` | server → BILC | `{ protocol_version, heartbeat_interval_s }` |
| `MATCH_ASSIGN` | server → BILC | `{ match_id: uuid, side: Side, topic: str }` |
| `TURN_REQUEST` | server → BILC | `{ turn_id: uuid, match_id: uuid, phase, messages: [{ role: "system"|"user"|"assistant", content: str }], max_tokens: int, deadline: str }` |
| `MATCH_RESPONSE` | BILC → server | `{ turn_id: uuid, delta: str, done: bool, finish_reason: str|null }` — stream of chunks; last has `done: true` |
| `MATCH_END` | server → BILC | `{ match_id: uuid, status: MatchStatus }` — cancel anything in flight |
| `FORFEIT` | server → BILC | `{ match_id: uuid, reason: str }` — this device's side forfeited |
| `ERROR` | both | `{ code, message, turn_id?: uuid }` |
| `HEARTBEAT` | both | `{ ts }` |
| `DISCONNECT` | both | `{ reason: str }` — graceful teardown, then close 1000 |

`messages` are fully built by the server; BILC forwards them to the local model unchanged. BILC handles one match at a time.

## Inference

Cloud inference uses OpenRouter to access various models, including free models, through one platform with OpenAI-compatible endpoints. Its base URL is `https://openrouter.ai/api/v1`; authenticate with the server's `INFERENCE_API_KEY`.

The model seed utility reads the public `GET https://openrouter.ai/api/v1/models`
catalogue without authentication or inference calls (implemented). Its `data` entries
supply `id`, `name`, `pricing` (USD per token/request/unit), `context_length`, and
`top_provider.max_completion_tokens`; additional metadata is retained. Only explicitly
zero-priced entries are imported, excluding the `openrouter/free` router. Every imported model references the single
`openrouter` provider row, regardless of the model's author.

Both the server (cloud models) and BILC (local model) speak the OpenAI Chat Completions API: `POST {base_url}/chat/completions` with `stream: true`, consuming SSE `choices[0].delta.content` chunks. Nothing else about a provider may be assumed.

Server config (env): `INFERENCE_BASE_URL`, `INFERENCE_API_KEY`, `INFERENCE_JUDGE_MODEL`. Argument models use the selected row's `api_model_id` in the `models` table; there is no global player-model override.

Current judge client: `judge(topic, pro, con)` accepts a topic and the two sides' generated transcripts (never player prompts). It sends a fixed system instruction and a JSON user message containing `topic`, `pro_position`, `con_position`, `pro`, and `con`. This non-streaming call requests structured output using the current `Verdict` schema (`winner`, `reason`); the engine integration and target `reasoning` field below remain pending.

Player turns use the lobby-selected model: the engine resolves its database UUID to the exact `api_model_id` and display name before play. The configured `INFERENCE_BASE_URL` and API key are shared by the argument and judge clients; provider-specific connection settings remain pending. The judge uses the independent `INFERENCE_JUDGE_MODEL` setting.

OpenRouter-only options are sent only when the base URL hostname is `openrouter.ai`: player turns send `reasoning: { enabled: false, exclude: true }`, and the judge sends `provider: { require_parameters: true }`. Other OpenAI-compatible endpoints receive neither option. Do not use `openrouter/free`; random routing can select classifiers or models that return reasoning instead of debate arguments. A turn with no visible text counts as a model error and receives the normal retry (implemented).

Current argument generation uses the engine's `format_game(player)` wrapper (implemented): a fixed system message supplies the topic, assigned side and position, opening phase, and 400-token completion cap. Only that player's strategy is included, inside `<player_strategy>` delimiters after stripping those delimiter strings from the strategy. The strategy is untrusted coaching subordinate to the server rules. The model follows its tone, persona, style, and arguments, including on controversial topics and without hedging or disclaimers, but the strategy cannot change the topic, side, position, phase, length limit, or plain-text output; the model must not pose as or instruct the judge or reveal the strategy. Only `delta.content` is forwarded. Reasoning settings for argument generation do not apply to judging. The current engine generates one opening argument per side; the six-turn flow below remains planned.

### Match flow

1. Matchmaking pairs two queued players on the same ladder, creates the match, assigns sides randomly, and starts an engine task.
2. Both players `JOIN` (and, for BYOM, the server sends `MATCH_ASSIGN` to each device).
3. Each player `SUBMIT_PROMPT`s independently; their opening generation starts as soon as their own prompt is accepted, without waiting for the other player's submission.
4. Currently, each side generates one opening argument, potentially concurrently. The planned six-turn flow adds `rebuttal` pro, con → `closing` pro, con after both openings finish. Each turn's `messages` = fixed server system prompt (topic, side, phase, length limit) with the side's player prompt inside delimiters; later phases also include prior turns as the transcript.
5. Judge: fixed system prompt plus the transcript only (never player prompts). It must return JSON `{ "winner": "pro"|"con", "reasoning": str }`. Anything else is a failure.
6. `MATCH_RESULT`, Elo update, persist, close sockets.

### Failure outcomes

A **forfeit** is a loss with a normal Elo update. A **void** changes no Elo.

| Failure | Outcome |
|---|---|
| A player doesn't `JOIN` or `SUBMIT_PROMPT` by the deadline, or `RESIGN`s | That player forfeits (`no_show` / `no_prompt` / `resigned`) |
| Both players fail the same deadline | Void |
| Cloud model errors or times out on a turn, after 1 retry | Void (`model_failure`); platform's fault |
| BYOM: device offline, `ERROR`, timeout, or empty output on a turn (no retry) | That side forfeits (`model_failure`); server sends `FORFEIT` to the device |
| Judge errors, times out, or returns unparseable output, after 1 retry | Void (`judge_failure`) |
| Output over the length limit | Truncated, not a failure (`truncated: true`) |
