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
| `RATE_LIMITED` | 429 | — | Too many requests |
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

## Shared types

```
UserRead         { id: uuid, email: str|null, username: str|null, avatar_url: str|null, elo: int }   (implemented; elo is removed when Rating ships; username is the user's tag, null until set)
UserPublic       { id: uuid, username: str|null, avatar_url: str|null }
Rating           { ladder: str, elo: int, games_played: int, wins: int, losses: int }
Ladder           { slug: str, display_name: str, kind: "cloud"|"byom" }
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
| GET | `/auth/google/callback` | public | OAuth params | 302 to `FRONTEND_URL`, sets session (implemented) |
| GET | `/auth/me` | session | — | `UserRead` (implemented) |
| POST | `/auth/logout` | public | — | 204, clears session (implemented) |
| PATCH | `/v1/users/me` | session | `{ username: str }` (3–24 chars, `[a-zA-Z0-9_]`, unique) | `UserRead` |
| GET | `/v1/users/username-availability` | session | `?username=` (≤ 64 chars) | `{ available: bool, code: str\|null, detail: str\|null }`; `code` is one of the `USERNAME_*` errors above when unavailable (implemented) |
| GET | `/v1/users/{id}` | session | `{id}: uuid` | `UserPublic + { ratings: [Rating] }` |
| GET | `/v1/users/{id}/matches` | session | `{id}: uuid`, `?limit&offset` | `[MatchSummary]`, finished only |
| GET | `/v1/ladders` | session | — | `[Ladder]` (active only) |
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

### Current matchmaking integration

The frontend currently uses the existing session-authenticated `POST /v1/match/queue` (no body; HTTP 202 queue status) and `GET /v1/match/status` (HTTP 200 queue status). Both return `{ status: "none"|"queued"|"matched", match_id?: uuid }`. These temporary routes use the single `provided` queue; model selection is not implemented. `POST /v1/match/queue` returns 403 `USERNAME_REQUIRED` until the caller has a tag. `DELETE /v1/match/queue` (session, no body) cancels the caller’s queue entry and returns HTTP 204, including if already absent; an existing match returns HTTP 409 `IN_MATCH`. The versioned routes above remain the target contract. The lobby polls until matched and displays the ID without navigating or opening a WebSocket.

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

`GET /v1/matches/{id}/ws` (`{id}: uuid`), session cookie. Server closes 4401 if unauthenticated, 4403 if not a participant. The client opens it when the queue poll returns `matched`, and reopens it to reconnect.

| Type | Direction | Payload |
|---|---|---|
| `JOIN` | client → server | `{ protocol_version: int }` — must be first |
| `MATCH_STATE` | server → client | `{ match_id: uuid, ladder, topic, status: MatchStatus, you: Side, participants: [Participant], ready: [Side], deadline: str|null, turns: [Turn] }` — sent after every `JOIN` (full snapshot for reconnects) |
| `SUBMIT_PROMPT` | client → server | `{ prompt: str }` — once per match |
| `PLAYER_READY` | server → client | `{ side: Side }` — a player's prompt was accepted |
| `TURN_START` | server → client | `{ turn_id: uuid, index, side, phase }` |
| `TURN_DELTA` | server → client | `{ turn_id: uuid, delta: str }` |
| `TURN_END` | server → client | `{ turn_id: uuid, truncated: bool }` |
| `JUDGING` | server → client | `{}` — sent to both connected players after argument generation finishes, immediately before the judge call (implemented) |
| `MATCH_RESULT` | server → client | `{ status, winner_side: Side|null, end_reason: EndReason, verdict_reasoning: str|null, participants: [Participant] }` — server then closes 1000 |
| `RESIGN` | client → server | `{}` |
| `HEARTBEAT` | both | `{ ts }` |
| `ERROR` | server → client | `{ code, message }` |

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

Both the server (cloud models) and BILC (local model) speak the OpenAI Chat Completions API: `POST {base_url}/chat/completions` with `stream: true`, consuming SSE `choices[0].delta.content` chunks. Nothing else about a provider may be assumed.

Server config (env): `INFERENCE_BASE_URL`, `INFERENCE_API_KEY`, `JUDGE_MODEL`. Ladder models name their provider model ID in the `models` table.

Current judge client: `judge(topic, pro, con)` accepts a topic and the two sides' generated transcripts (never player prompts). It sends a fixed system instruction and a JSON user message containing `topic`, `pro_position`, `con_position`, `pro`, and `con`. This non-streaming call requests structured output using the current `Verdict` schema (`winner`, `reason`); the engine integration and target `reasoning` field below remain pending.

Current argument generation uses the engine's `format_game(player)` wrapper (implemented): a fixed system message supplies the topic, assigned side and position, opening phase, and current token budget. Only that player's strategy is included, inside `<player_strategy>` delimiters after stripping those delimiter strings from the strategy. The strategy is explicitly subordinate to the server rules. The current engine generates one opening argument per side; the six-turn flow below remains planned.

### Match flow

1. Matchmaking pairs two queued players on the same ladder, creates the match, assigns sides randomly, and starts an engine task.
2. Both players `JOIN` (and, for BYOM, the server sends `MATCH_ASSIGN` to each device).
3. Both players `SUBMIT_PROMPT`.
4. Six turns: `opening` pro, con → `rebuttal` pro, con → `closing` pro, con. Each turn's `messages` = fixed server system prompt (topic, side, phase, length limit) with the side's player prompt inside delimiters, then prior turns as the transcript.
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
