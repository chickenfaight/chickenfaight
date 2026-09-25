# BILC — BYOM Interface Layer Client (PLANNED)

A Go CLI on the user's machine that connects their local LLM to the server so it can compete in the BYOM arena. It keeps one WebSocket open to the server and forwards each `TURN_REQUEST` to the local model, streaming the output back. Every message and endpoint it uses is defined in [PROTOCOL.md](../PROTOCOL.md). Do not invent any others.

Nothing is built yet; this doc is the spec. Remove the PLANNED tag once `bilc run` works end to end.

## Principles

- **Dumb pipe.** BILC forwards server-built `messages` to the model unchanged and returns output unchanged. Game logic stays on the server.
- **The server never controls the machine.** BILC only calls the model URL from local config; nothing from the server can change it, name a file, or run a command.
- **Fail loudly, fail contained.** A model error ends that turn with `ERROR`, not the process. A crash in one match never corrupts auth or config.
- **Everything blocking takes a `context.Context`** with a deadline, and is cancelled on `MATCH_END`, `FORFEIT`, or shutdown.

## Layout

```
bilc/
  cmd/bilc/main.go        CLI entry: parses commands, wires components
  internal/config/        config file load/save
  internal/auth/          Auth
  internal/conn/          ConnectionManager
  internal/model/         ModelInterface + OpenAI-compatible implementation
  internal/match/         MatchHandler
  internal/update/        UpdateManager
  internal/protocol/      message structs mirroring PROTOCOL.md
```

Standard library first. Allowed third-party packages: a WebSocket library (`github.com/coder/websocket`), `github.com/zalando/go-keyring`, `github.com/creativeprojects/go-selfupdate`, `golang.org/x/sync/errgroup`. Anything else needs a reason in the PR. Code must pass `gofmt`, `go vet`, and `go test -race ./...`. No package-level mutable state.

## Components

Responsibilities follow the design doc's class diagram. Package boundaries may flex, but each responsibility has exactly one owner.

| Component | Owns | Does not |
|---|---|---|
| **Auth** | Pairing (`/bilc/register`), refresh→access token exchange (`/bilc/token`), storing `bilc_id` + refresh token, refreshing the JWT before expiry | Touch the socket or model |
| **ConnectionManager** | Dial `/api/v1/bilc/ws` with the JWT, send `HELLO`, wait for `HELLO_ACK`, echo heartbeats, reconnect with exponential backoff (1 s → 30 s, with jitter), a single writer goroutine, close codes | Interpret match messages |
| **ModelInterface** | Talking to the local model | Know about matches or the server |
| **MatchHandler** | Handling `MATCH_ASSIGN`/`TURN_REQUEST`/`MATCH_END`/`FORFEIT`, one match at a time, per-turn deadlines, streaming `MATCH_RESPONSE`, mapping model failures to `ERROR` codes | Retry a failed turn (the server decides outcomes) |
| **UpdateManager** | Version checks and self-update | Update during a match |

```go
type Model interface {
    Info(ctx context.Context) (ModelInfo, error)                  // name, context length, metadata for HELLO
    Stream(ctx context.Context, req TurnRequest) (<-chan Chunk, error)
}
```

The default `Model` is an OpenAI Chat Completions client (`POST {base_url}/chat/completions`, `stream: true`). That covers Ollama, LM Studio, llama.cpp server, and vLLM. Other backends are new implementations of `Model`; nothing else changes.

Error mapping: model unreachable → `MODEL_UNAVAILABLE`; non-2xx or malformed stream → `MODEL_ERROR`; deadline passed → `MODEL_TIMEOUT`. `MATCH_ASSIGN` while busy → `BILC_BUSY`.

## Commands

| Command | Does |
|---|---|
| `bilc pair <code>` | Register with a code from the web app's `/bilc` page |
| `bilc model set --url <base_url> --model <name>` | Configure the local model; verifies it responds |
| `bilc run` | Connect and serve matches until Ctrl-C (sends `DISCONNECT`, then exits) |
| `bilc status` | Paired?, model reachable?, server reachable?, version |
| `bilc update` | Update now |
| `bilc unpair` | Delete local credentials (revoke from the web app too) |

Output is short, human-readable lines to stderr. Never print tokens, codes after use, or prompt contents (log sizes and IDs only). `--verbose` adds timings.

## Pairing and auth flow

1. User clicks "Pair device" at `/bilc` in the web app → `POST /api/v1/bilc/pairing-codes` → 8-char code, valid 10 min, single use.
2. `bilc pair <code>` → `POST /api/v1/bilc/register` → `bilc_id` + refresh token.
3. Store the refresh token in the OS keychain (`go-keyring`). If there's no keychain, use a file in the config dir with mode `0600`, and warn.
4. `bilc run` → `POST /api/v1/bilc/token` → 15-min access JWT + a **new** refresh token, which replaces the stored one before any other step.
5. Dial the WebSocket with `Authorization: Bearer <jwt>`. Refresh before `expires_at` and on 4401, then reconnect.
6. `TOKEN_INVALID` or 4403 (revoked) → stop, delete credentials, and tell the user to re-pair.

## Config

`os.UserConfigDir()/chickenfaight/bilc/config.json` holds `server_url` (default: production), `model.base_url`, `model.name`, and `bilc_id`. It never holds secrets. If `model.base_url` is not a loopback address, warn on every start: prompts leave the machine.

## Updates

GitHub Releases, built by GoReleaser. It's the common setup for Go CLIs and needs no infrastructure of our own.

- Release CI builds `mac|win|linux` × `amd64|arm64` static binaries plus `checksums.txt`, and signs `checksums.txt` with an ed25519 key held in CI secrets. The public key is compiled into BILC.
- UpdateManager calls `GET /api/v1/bilc/releases/latest` on start and every 24 h. If the running version is below `min_supported_version`, refuse to serve matches and prompt `bilc update`. If it's only below `version`, print a notice.
- `bilc update` (via `go-selfupdate`) downloads the asset, verifies the signature on `checksums.txt` and the asset's SHA-256, then replaces the binary. Any verification failure aborts with no change.
- Never update automatically mid-match. `bilc run` may update between matches only if the user passed `--auto-update`.
- A 426 or `BILC_OUTDATED` from the server always means "run `bilc update`".
