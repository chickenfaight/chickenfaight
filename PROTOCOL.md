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
| `TAG_INVALID` | 422 | — | Tag breaks the format rule (implemented) |
| `TAG_NOT_ALLOWED` | 422 | — | Tag fails the profanity filter (implemented) |
| `TAG_TAKEN` | 409 | — | Tag already used by someone, ignoring case (implemented) |
| `TAG_ALREADY_SET` | 409 | — | Caller already has a tag; tags never change (implemented) |
| `TAG_REQUIRED` | 403 | — | Caller must set a tag first (implemented) |
| `AVATAR_INVALID` | 422 | — | Upload isn't a PNG, JPEG, or WebP image, is over 2 MB or 25 megapixels, or is corrupt (implemented) |
| `CHALLENGE_ALREADY_COMPLETED` | 409 | — | Caller already completed today's daily challenge (implemented) |
| `CONVERSATION_INVALID` | 422 | — | Tips chat turns don't alternate starting and ending with the player (implemented) |
| `CONVERSATION_TOO_LONG` | 422 | — | Tips chat over 8,000 characters in total (implemented) |
| `MODEL_UNAVAILABLE` | 502 | — | The tips model failed or sent nothing within 30 s (implemented) |
| `USERNAME_INVALID` | 422 | — | Username is blank after trimming, over 32 characters, or contains control or invisible formatting characters (implemented) |
| `USERNAME_NOT_ALLOWED` | 422 | — | Username fails the profanity filter (implemented) |
| `BILC_OFFLINE`, `BILC_BUSY` | 409 | — | BYOM device can't take a match: not connected, or already in one (implemented). BILC also sends `BILC_BUSY` as an `ERROR` for a second match or turn |
| `PAIRING_CODE_INVALID` | 400 | — | Wrong, used, or expired pairing code (implemented) |
| `TOKEN_INVALID` | 401 | — | Bad, reused, or expired refresh token, or a revoked or deleted device (reuse revokes the device) (implemented) |
| `UNSUPPORTED_VERSION` | 426 | 4426 | `protocol_version` not supported |
| `BILC_OUTDATED` | 426 | 4426 | `client_version` < `min_supported_version` (implemented on the socket: close reason `BILC_OUTDATED: run bilc update`) |
| `PROMPT_ALREADY_SUBMITTED`, `PROMPT_TOO_LONG` | — | — | Prompt rejected (no close) |
| `MODEL_UNAVAILABLE`, `MODEL_ERROR`, `MODEL_TIMEOUT` | — | — | Sent by BILC about the local model (implemented) |
| `HEARTBEAT_TIMEOUT` | — | 4408 | No message within the timeout |
| `REPLACED` | — | 4409 | A newer connection for the same user+match or device |
| `FRIEND_SELF` | 422 | — | Players can't add themselves as friends (implemented) |
| `INVALID_CREDENTIALS` | 401 | — | Password sign-in failed. Same response for a wrong password, an unknown tag, or an account without a password (implemented) |
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
| Pairing code TTL (implemented) | 10 min, single use |
| BILC access JWT / refresh token (implemented) | 15 min / 30 days, rotated on every use (each rotation restarts the 30 days) |
| BILC rate limits (implemented) | `POST /v1/bilc/pairing-codes`: a burst of 5 and 5/min per user. `POST /v1/bilc/register`: a burst of 10 and 10/min per client IP. `POST /v1/bilc/token`: a burst of 20 and 20/min per client IP |
| Web session (implemented) | 14 days from sign-in, not extended by use; logout ends it immediately |
| REST rate limits, per user (implemented) | Token buckets, each holding a burst and refilling steadily: search, profile lookup, tag availability, and friends list each allow a burst of 20 and 60/min; adding and removing friends share a burst of 10 and 20/min |
| Points and streaks (implemented) | Days are UTC. Only players who finished the match score: both in a judged match, only the winner of a forfeit, nobody in a void. +10 for finishing, +10 for winning, +50 for the day's challenge (once per UTC day, counted only if the match ends that same day), and +25 at every 7th consecutive day. A finished match on a new UTC day extends the streak if the previous one was within 48 h, and otherwise restarts it at 1 |
| Tips chat rate limit (implemented) | A burst of 5 and 10/min per user |
| Profile picture rate limits (implemented) | Upload: a burst of 5 and 10/min per user. Viewing pictures: a burst of 100 and 300/min per user, since one page can show 20 |
| Sign-in and signup rate limits (implemented) | `POST /auth/login`: a burst of 10 and 10/min per client IP, plus a burst of 5 and 1/min per tag (ignoring case), so many IPs can't share the guessing. `POST /auth/signup`: a burst of 5 and 1/min per client IP |

Rate limits apply per signed-in user on routes that read other users' data or change the friends list, and per IP or tag on sign-in and signup. They're held in server memory, so they reset when the server restarts.

## Shared types

```
UserRead         { id: uuid, email: str|null, tag: str|null, username: str|null, avatar_url: str|null, elo: int }   (implemented; elo is removed when Rating ships)
UserPublic       { id: uuid, tag: str|null, username: str|null, avatar_url: str|null }   (implemented)
                 `tag` is the permanent unique identifier, null until set and never changed. `username` is the changeable display name: not unique, null until set; clients show it, falling back to the tag.
UserProfile      UserPublic + { ratings: [Rating], is_friend: bool, points: int, streak: int, rank: int|null }   (implemented; `ratings` is empty until ratings ship; `is_friend` is whether the caller has added this player; `streak` is already 0 if 48 h passed without a finished match; `rank` is the 1-based position by points among tagged players, ties sharing a rank)
Rating           { ladder: str, elo: int, games_played: int, wins: int, losses: int }
Ladder           { slug: str, display_name: str, kind: "cloud"|"byom" }
ArenaRead        { id: uuid, display_name: str, kind: "provided"|"byom" } (implemented; for "provided", id is the model's UUID; the one "byom" arena, listed last, has the fixed id in "BYOM arena" below)
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
                   size_class: "small"|"medium"|"large"|null, online: bool, status: "offline"|"idle"|"busy",
                   last_seen_at: str|null, created_at: str }   (implemented; `model_name` is `HELLO.model.name`, null until the device first connects; `size_class` is from the live connection's `HELLO`, else the last one stored (see "BYOM arena"); `online` means its socket finished `HELLO`; `status` is `busy` while reserved for a match, which outlasts a dropped socket; `last_seen_at` is the last pairing, token refresh, or `HELLO`)
```

Player prompts are never returned by any endpoint or message except to their author.

## REST — web client

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/health` | public | — | `{ status: "healthy" }` (implemented) |
| GET | `/auth/google/login` | public | — | 302 to Google (implemented) |
| GET | `/auth/google/callback` | public | OAuth params | Redirect to `FRONTEND_URL` on success; starts a server-side session and sets the session cookie. Cancelled or rejected OAuth and invalid identity data (including an unverified email) redirect to `FRONTEND_URL/login` without starting a session (implemented) |
| GET | `/auth/me` | session | — | `UserRead`. This is how clients validate a stored session: 401 if the cookie is missing, forged, expired, or logged out (implemented) |
| POST | `/auth/signup` | public | `{ tag: str, username: str, email?: str (≤ 320), password: str (8–128) }`. `tag` and `username` follow their rules above | 204 and sets the session cookie; `TAG_*` and `USERNAME_*` errors; 422 for a malformed body (implemented) |
| POST | `/auth/login` | public | `{ tag: str (≤ 64, ignoring case), password: str (1–128) }`. Sign-in uses the tag, never the username, since usernames change and repeat | 204 and sets the session cookie; 401 `INVALID_CREDENTIALS` (implemented) |
| POST | `/auth/logout` | public | — | 204; deletes the session server-side, so a copy of the old cookie stops working, and clears the cookie (implemented) |
| PUT | `/v1/users/me/tag` | session | `{ tag: str }` (3–24 chars, `[a-zA-Z0-9_]`, unique ignoring case) | `UserRead`; sets the tag once, then `TAG_ALREADY_SET` (implemented) |
| PUT | `/v1/users/me/avatar` | session | Raw image body (PNG, JPEG, or WebP, ≤ 2 MB) | `UserRead`; re-encoded to a 256×256 WebP with metadata removed; `avatar_url` becomes `/v1/users/{id}/avatar?v=…`, relative to the backend, with a new `v` on every upload; 422 `AVATAR_INVALID` (implemented) |
| DELETE | `/v1/users/me/avatar` | session | — | `UserRead` with `avatar_url: null`; the Google picture returns at the next Google sign-in (implemented) |
| GET | `/v1/users/{id}/avatar` | session | `{id}: uuid` | The WebP image, `Cache-Control: private, max-age=31536000, immutable`; 404 `NOT_FOUND` without an upload (implemented) |
| DELETE | `/v1/users/me` | session | — | 204; permanently deletes the caller: leaves any queue, forfeits a live match (`resigned`), deletes the user with their sessions and friendships (both directions), and clears the cookie. Signing in with Google again creates a new account (implemented) |
| PATCH | `/v1/users/me` | session | `{ username: str }` (1–32 chars after trimming; not unique) | `UserRead`; changes the username any number of times; `USERNAME_*` errors (implemented) |
| GET | `/v1/users/tag-availability` | session | `?tag=` (≤ 64 chars) | `{ available: bool, code: str\|null, detail: str\|null }`; `code` is one of the `TAG_*` errors above when unavailable (implemented) |
| GET | `/v1/users/search` | session | `?q=` (1–64 chars), `?limit=` (1–50, default 20), `?offset=` (≥ 0, default 0) | `{ items: [UserPublic], next_offset: int\|null }`; only users with a tag; ranked exact tag, then prefix, then contains, then fuzzy (trigram word similarity), all ignoring case; `next_offset` is null on the last page; a blank `q` returns no items (implemented) |
| GET | `/v1/users/by-tag/{tag}` | session | `{tag}`: ignoring case | `UserProfile`; 404 `NOT_FOUND` if no user has that tag (implemented) |
| GET | `/v1/users/{id}` | session | `{id}: uuid` | `UserProfile` |
| GET | `/v1/users/{id}/matches` | session | `{id}: uuid`, `?limit&offset` | `[MatchSummary]`, finished only |
| GET | `/v1/friends` | session | `?limit=` (1–100, default 50), `?offset=` (≥ 0, default 0) | `{ items: [UserPublic], next_offset: int\|null }`: the caller's own friends only, ordered by tag ignoring case. No route lists another player's friends (implemented) |
| PUT | `/v1/friends/{user_id}` | session | `{user_id}: uuid` | 204, also if already a friend. Adding is one-way; the other player doesn't approve it. 404 `NOT_FOUND` if no tagged player has that ID; 422 `FRIEND_SELF` for the caller's own ID (implemented) |
| DELETE | `/v1/friends/{user_id}` | session | `{user_id}: uuid` | 204, also if not a friend (implemented) |
| GET | `/v1/ladders` | session | — | `[Ladder]` (active only) |
| GET | `/v1/challenge/today` | session | — | `{ day: date, topic: TopicRead\|null, twist: { title, description, max_chars: int\|null }, reward_points: int, completed: bool, resets_at: datetime }`. The same for everyone each UTC day: the topic is a stable pick from active topics, and the twist rotates (implemented) |
| GET | `/v1/tips` | session | — | `{ tips: [str] }`: the coach's predefined tips (implemented) |
| POST | `/v1/tips/chat` | session | `{ model_id: uuid, messages: [{ role: "user"\|"assistant", content: str (1–2,000) }] }` (1–20 messages, alternating, starting and ending with `user`, ≤ 8,000 characters in total) | 200 `text/plain` stream of the coach's reply (≤ 500 tokens); 404 `NOT_FOUND` for an inactive or unknown model; `CONVERSATION_*` errors; 502 `MODEL_UNAVAILABLE` if the model fails before replying; a failure mid-reply ends the stream with `[The model stopped responding.]`. Nothing is stored (implemented) |
| GET | `/v1/arenas` | session | — | `[ArenaRead]` (active models only; implemented) |
| GET | `/v1/ladders/{slug}/leaderboard` | session | `?limit&offset` | `[{ rank, user: UserPublic, rating: Rating }]` |
| POST | `/v1/matchmaking/queue` | session | `{ ladder: str, bilc_id?: uuid }` (`bilc_id` required iff ladder is BYOM, must be caller's online idle device) | 202 `{ status: "queued" }` |
| GET | `/v1/matchmaking/queue` | session | — | `{ status: "none"|"queued"|"matched", match_id?: uuid }` |
| DELETE | `/v1/matchmaking/queue` | session | — | 204 |
| GET | `/v1/matches/{id}` | session | `{id}: uuid` | `MatchRead`; live matches visible to participants only |
| POST | `/v1/matches/{id}/votes` | session | `{id}: uuid`, `{ side: Side }` | 204; finished matches, non-participants, one vote per user (upsert) |
| POST | `/v1/bilc/pairing-codes` | session | — | `{ code: str (8 chars, A–Z 2–9), expires_at }`; also deletes the caller's used and expired codes (implemented) |
| GET | `/v1/bilc/devices` | session | — | `[BilcDevice]` (caller's only, not revoked, newest first; implemented) |
| DELETE | `/v1/bilc/devices/{id}` | session | `{id}: uuid` | 204; revokes tokens, closes its socket 4403; 404 `NOT_FOUND` for another user's, revoked, or unknown device (implemented) |

`/health` and `/auth/*` stay unversioned: the OAuth redirect URI is registered with Google.

The six `public` rows above, plus `POST /v1/bilc/register` and `POST /v1/bilc/token` below (whose credential is the pairing code or refresh token in the body), are the only routes reachable without a session; `tests/integration/test_route_auth.py` enforces this for every route. FastAPI's `/docs`, `/redoc`, and `/openapi.json` exist only when `APP_ENV=development` (implemented). Passwords are sent as typed, never hashed by the client (a client-side hash would itself be the password); the server stores only a salted scrypt hash. Use HTTPS outside local development.

### BYOM arena (implemented)

The BYOM arena is `ArenaRead { id: "6f1c9a52-3d8e-4b7a-9e21-b10c0000b10c", display_name: "Bring your own model", kind: "byom" }`, always listed last by `GET /v1/arenas`. Each player plays with their own BILC device, so it has no `models` row, and matches record `model_id` null.

- **Queueing:** `POST /v1/match/queue` with that `model_id` and `bilc_id`: one of the caller's own unrevoked devices (else 404 `NOT_FOUND`), connected (else 409 `BILC_OFFLINE`, whose `detail` says to run `bilc run`) and idle (else 409 `BILC_BUSY`). A missing `bilc_id` or `daily: true` is 422 `VALIDATION_ERROR`: the daily challenge isn't played here.
- **Size classes:** from `HELLO.model.metadata.parameter_size` (Ollama's format, e.g. `"8.0B"`): `small` under 8B parameters, `medium` 8B–30B, `large` over 30B. The size is self-reported. An unknown size counts as `large`, so hiding a size can't place a big model among small ones.
- **Pairing:** every second, longest-waiting players first, each is paired with the oldest queued player of the same class; once either of the two has waited 30 s, a neighboring class (small–medium, medium–large) is allowed too, never small–large. Players whose device is offline or busy at that moment stay queued but aren't paired. Pairing reserves both devices (`busy`) until the match ends.
- **In the match:** `MATCH_STATE.model_display_name` is `"Your model: <HELLO.model.name>"`, each player's own. Each side's turns go to its player's device; failures follow the BYOM row of "Failure outcomes".

### Current matchmaking integration

The current session-authenticated `POST /v1/match/queue` requires `{ model_id: uuid, daily?: bool, bilc_id?: uuid }` from `GET /v1/arenas`. `bilc_id` is required for the BYOM arena and refused (422 `VALIDATION_ERROR`) otherwise; see "BYOM arena" (implemented). `daily: true` joins today's daily-challenge queue for that model, separate from the regular queue, and returns 409 `CHALLENGE_ALREADY_COMPLETED` once the caller has completed today's challenge (implemented); an unknown or inactive model returns 404 `NOT_FOUND`, and malformed input returns 422. It returns HTTP 202 queue status. `GET /v1/match/status` returns HTTP 200 queue status. Both return `{ status: "none"|"queued"|"matched", match_id?: uuid }`. Matchmaking uses independent FIFO queues keyed by model UUID. The matchmaker passes the selected model UUID to the engine, which resolves its exact `api_model_id` and display name before inference. The client still uses the configured OpenRouter base URL and API key; provider-specific connection settings remain pending. The frontend integration is implemented: the lobby loads the arena catalog, displays model names, and sends the selected UUID in the required body. Selection stays locked during queue operations; recovered queues have an unknown model until `MATCH_STATE` arrives. Catalog failures do not block queue cancellation. `POST /v1/match/queue` returns 403 `TAG_REQUIRED` until the caller has a tag. `DELETE /v1/match/queue` (session, no body) cancels the caller’s queue entry in its selected model queue and returns HTTP 204, including if already absent; an existing match returns HTTP 409 `IN_MATCH`. The versioned routes above remain the target contract. The lobby polls until matched, then navigates to `/match/[match_id]`, where the arena opens the match WebSocket.

## REST — BILC

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/v1/bilc/register` | pairing code in body | `{ pairing_code: str (≤ 16; case, spaces, and hyphens ignored), device_name: str (1–64), platform: str (1–32), client_version: str (1–32) }`; text fields are trimmed and can't contain control or invisible formatting characters | `{ bilc_id: uuid, refresh_token: str }`; 400 `PAIRING_CODE_INVALID`; 422 for a malformed body (implemented) |
| POST | `/v1/bilc/token` | refresh token in body | `{ bilc_id: uuid, refresh_token: str (≤ 128) }` | `{ access_token, expires_at, refresh_token }`; 401 `TOKEN_INVALID` (implemented) |
| GET | `/v1/bilc/releases/latest` | public | — | `{ version, min_supported_version, protocol_version, assets: [{ platform, arch, url, sha256 }] }` (PLANNED; `install.sh` reads GitHub Releases directly) |
| GET | `/v1/bilc/download` | public | `?platform=mac|win|linux&arch=amd64|arm64` | 302 to the release asset |

Access JWT: HS256 with `BILC_JWT_SECRET`, claims `sub` = `bilc_id` (uuid), `uid` = user id (uuid), `aud` = `"bilc"`, `iat`, `exp` (implemented). Each refresh token works once. Presenting the one just replaced revokes the device and closes its socket 4403; any other wrong token gets `TOKEN_INVALID` without revoking.

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

- `MATCH_STATE`: `{ match_id, model_display_name, topic: { category, topic, pro_position, con_position }, you, participants: [{ user_id, side }], deadline }`. `model_display_name` is the selected model's database display name. `deadline` is an ISO UTC timestamp, established once both players connect using the server's 120-second prompt window. `challenge` is `{ title, description, max_chars: int|null }` for a daily-challenge match, else null; a prompt breaking it gets `ERROR` `PROMPT_BREAKS_CHALLENGE` and may be resubmitted (implemented).
- `TURN_DELTA`: `{ delta }`, sent only to the author of the generating side.
- `TURN_END`: `{}`, sent to that same player once their opening argument finishes.
- `MATCH_RESULT`: `{ winner: "pro"|"con"|null, reason, status: "completed"|"forfeited"|"voided", end_reason: "judged"|"no_prompt"|"resigned"|"model_failure"|"judge_failure", arguments: { pro, con } }`. Only generated arguments are shared; player prompts remain private. A missed prompt deadline forfeits to the side that submitted; if neither submitted, the match is void. A cloud turn that errors or times out (30 s to first token, 90 s total) is retried once, unless part of it already streamed to the player, since a retry would duplicate that text; if it still fails, the match is void (`model_failure`), even if a prompt deadline also passed. A judge error, timeout (120 s), or unparseable verdict is retried once, then voids the match (`judge_failure`). `RESIGN` before any result stops generation or judging and forfeits to the other side (`resigned`); the first decided result is final. Once a match has a result, `GET /v1/match/status` stops reporting it as `matched`. These outcomes do not yet persist results or update Elo.
- `ERROR` also includes `PROMPT_DEADLINE_PASSED` when a submission arrives after the server deadline.

The browser retains `model_display_name` from `MATCH_STATE` and displays it throughout composition, generation, judging, and results (implemented). It echoes heartbeats, retains its submitted prompt in page memory, marks its argument complete on `TURN_END`, and changes the waiting message on `JUDGING`. Reload/reconnect recovery remains planned.

Disconnecting after submitting a prompt does not affect the match; turns keep running.

## WebSocket — BILC

`GET /v1/bilc/ws`, header `Authorization: Bearer <access_token>`. The server tracks each device as online/idle/busy from this socket.

Implemented: everything in the table below (for the opening phase), plus replacement (4409), revocation and account deletion (4403), `BAD_MESSAGE`, and `UNKNOWN_TYPE`. The server checks the token before accepting: an invalid or expired token or an unknown device is 4401, and a revoked device or one whose `uid` isn't its owner is 4403. Through uvicorn, a rejection before accepting reaches the client as an HTTP 403 handshake failure without the close code, so BILC refreshes its token on any rejection, and a revoked device then gets `TOKEN_INVALID` there. Until a valid `HELLO` arrives, other frames get `ERROR` `BAD_MESSAGE`; a `protocol_version` other than 1 closes 4426 (`UNSUPPORTED_VERSION`), and a `client_version` below `BILC_MIN_SUPPORTED_VERSION` (env, default `0.1.0`) closes 4426 with reason `BILC_OUTDATED: run bilc update`; unversioned `dev` builds pass only when `APP_ENV=development`. 45 s without a `HELLO` closes 4408. `HELLO.model` is capped at 4 KB, and its `client_version`, `platform`, and `model` are stored on the device.

Matches: when the engine starts, each device gets `MATCH_ASSIGN`; a device that reconnects while still reserved gets it again after `HELLO_ACK`. Each turn is one `TURN_REQUEST` (`phase` is `opening` for now; `deadline` is 90 s ahead). `MATCH_RESPONSE`s are validated (a bad one gets `BAD_MESSAGE`), and ones for unknown or abandoned turns are ignored. An `ERROR` with a `turn_id`, or the socket closing, fails that turn. When the match ends for any reason, both devices get `MATCH_END` with the final status and become idle; a device whose side forfeited gets `FORFEIT` first, with the failure code as `reason`.

| Type | Direction | Payload |
|---|---|---|
| `HELLO` | BILC → server | `{ protocol_version, client_version, platform, model: { name: str, context_length: int|null, metadata: object } }` — must be first. `metadata` may carry Ollama's `parameter_size`, `quantization_level`, and `family` (strings) |
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

BILC initially supports local Ollama only. Service startup/readiness uses
`GET http://127.0.0.1:11434/api/version` (implemented), requiring HTTP 200 and
a JSON object with a nonempty `version` string. This local Ollama endpoint
requires no authentication and is used only to recognize a running service;
no model inference is performed. If unreachable, BILC starts the installed
`ollama serve` process on that same loopback address. Ollama lifecycle details
are in [BILC.md](bilc/BILC.md); model inference and server integration remain planned.

Server config (env): `INFERENCE_BASE_URL`, `INFERENCE_API_KEY`, `INFERENCE_JUDGE_MODEL`. Argument models use the selected row's `api_model_id` in the `models` table; there is no global player-model override.

Current judge client: `judge(topic, pro, con)` accepts a topic and the two sides' generated transcripts (never player prompts). It sends a fixed system instruction and a JSON user message containing `topic`, `pro_position`, `con_position`, `pro`, and `con`. This non-streaming call requests structured output using the current `Verdict` schema (`winner`, `reason`); the engine integration and target `reasoning` field below remain pending.

Player turns use the lobby-selected model: the engine resolves its database UUID to the exact `api_model_id` and display name before play. The configured `INFERENCE_BASE_URL` and API key are shared by the argument and judge clients; provider-specific connection settings remain pending. The judge uses the independent `INFERENCE_JUDGE_MODEL` setting.

OpenRouter-only options are sent only when the base URL hostname is `openrouter.ai`: player turns send `reasoning: { enabled: false, exclude: true }`, and the judge sends `provider: { require_parameters: true }`. Other OpenAI-compatible endpoints receive neither option. Do not use `openrouter/free`; random routing can select classifiers or models that return reasoning instead of debate arguments. A turn with no visible text counts as a model error and receives the normal retry (implemented).

Current argument generation uses the engine's `format_game(player)` wrapper (implemented): a fixed system message supplies the topic, assigned side and position, opening phase, and 400-token completion cap, followed by a fixed user message, `Give your opening argument now.` (never player text; without a user turn, small local models print the template's `assistant` header and refuse). Only that player's strategy is included, inside `<player_strategy>` delimiters after stripping those delimiter strings from the strategy. The strategy is untrusted coaching subordinate to the server rules. The model follows its tone, persona, style, and arguments, including on controversial topics and without hedging or disclaimers, but the strategy cannot change the topic, side, position, phase, length limit, or plain-text output; the model must not pose as or instruct the judge or reveal the strategy. Only `delta.content` is forwarded. Reasoning settings for argument generation do not apply to judging. The current engine generates one opening argument per side; the six-turn flow below remains planned.

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
| BYOM: device offline, `ERROR`, timeout (30 s to first token, 90 s total), or empty output on a turn (no retry) | That side forfeits (`model_failure`); server sends `FORFEIT` to the device (implemented). The first failure ends generation; both devices failing in the same step voids the match |
| Judge errors, times out, or returns unparseable output, after 1 retry | Void (`judge_failure`) |
| Output over the length limit | Truncated, not a failure (`truncated: true`) |
