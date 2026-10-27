# BILC — BYOM Interface Layer Client (PLANNED)

A Go CLI on the user's machine that connects their local LLM to the server so it can compete in the BYOM arena. It keeps one WebSocket open to the server and forwards each `TURN_REQUEST` to the local model, streaming the output back. Every message and endpoint it uses is defined in [PROTOCOL.md](../PROTOCOL.md). Do not invent any others.

The CLI foundation and Ollama lifecycle are implemented: help, version output (`dev`), `run` argument parsing, service reuse/startup, and cancellation/cleanup. The shared model interface and input/output structs exist in `internal/model/model.go`; `openai.go` is only a placeholder. `bilc run` ensures Ollama is ready, then waits for Ctrl-C or SIGTERM. Inference and server integration remain planned. Remove the PLANNED tag once `bilc run` works end to end.

## Principles

- **Dumb pipe.** BILC forwards server-built `messages` to the model unchanged and returns output unchanged. Game logic stays on the server.
- **The server never controls the machine.** BILC only calls the model URL from local config; nothing from the server can change it, name a file, or run a command.
- **Fail loudly, fail contained.** A model error ends that turn with `ERROR`, not the process. A crash in one match never corrupts auth or config.
- **Everything blocking takes a `context.Context`** with a deadline, and is cancelled on `MATCH_END`, `FORFEIT`, or shutdown.

## Layout

```
bilc/
  cmd/bilc/main.go        CLI entry: parses commands, wires components
  cmd/bilc/run.go         signal context and Ollama lifecycle coordination
  internal/ollama/        local service readiness and owned process cleanup
  internal/model/         shared model contract; OpenAI implementation planned
  internal/config/        PLANNED: config file load/save
  internal/auth/          PLANNED: Auth
  internal/conn/          PLANNED: ConnectionManager
  internal/match/         PLANNED: MatchHandler
  internal/update/        PLANNED: UpdateManager
  internal/protocol/      PLANNED: message structs mirroring PROTOCOL.md
```

Standard library first. Allowed third-party packages: a WebSocket library (`github.com/coder/websocket`), `github.com/zalando/go-keyring`, `github.com/creativeprojects/go-selfupdate`, `golang.org/x/sync/errgroup`. Anything else needs a reason in the PR. Code must pass `gofmt`, `go vet`, and `go test -race ./...`. No package-level mutable state.

## Components

Responsibilities follow the design doc's class diagram. Package boundaries may flex, but each responsibility has exactly one owner.

| Component | Owns | Does not |
|---|---|---|
| **Auth** | Pairing (`/v1/bilc/register`), refresh→access token exchange (`/v1/bilc/token`), storing `bilc_id` + refresh token, refreshing the JWT before expiry | Touch the socket or model |
| **ConnectionManager** | Dial `/v1/bilc/ws` with the JWT, send `HELLO`, wait for `HELLO_ACK`, echo heartbeats, reconnect with exponential backoff (1 s → 30 s, with jitter), a single writer goroutine, close codes | Interpret match messages |
| **ModelInterface** | Talking to the local model | Know about matches or the server |
| **MatchHandler** | Handling `MATCH_ASSIGN`/`TURN_REQUEST`/`MATCH_END`/`FORFEIT`, one match at a time, per-turn deadlines, streaming `MATCH_RESPONSE`, mapping model failures to `ERROR` codes | Retry a failed turn (the server decides outcomes) |
| **UpdateManager** | Version checks and self-update | Update during a match |

```go
type Model interface {
    Info(ctx context.Context) (ModelInfo, error)                  // name, context length, metadata for HELLO
    Stream(ctx context.Context, req TurnRequest) (<-chan Chunk, error)
}
```

## Integration contract

Match-handler tests use a fake implementing `model.Model`; neither Ollama nor completed auth is needed. Connection tests use a fake WebSocket server and test credentials. Production pairing/auth and end-to-end serving are still planned; do not bypass server authentication to develop the relay.

### Shared model contract

`internal/model/model.go` defines `Model`, `Message`, `TurnRequest`, `ModelInfo`, and `Chunk`. These types form the boundary between inference and match handling:

- `TurnRequest` contains only `Messages` and `MaxTokens`. The local client selects its configured model and URL. Forward message roles, content, and order unchanged; do not mutate the request after passing it to `Stream`.
- `ModelInfo` supplies name, optional context length (`nil` means unknown), and metadata for `HELLO`. It is not itself a wire payload.
- `Chunk` contains `Delta`, `Done`, nullable `FinishReason`, and `Err`. The consumer processes any `Delta` before completion. No reasoning text is forwarded.
- `Stream` returns `nil, err` if setup fails, otherwise a non-nil receive-only channel and `nil`. Failures after return arrive in `Chunk.Err`.
- A successful stream sends exactly one terminal `Done: true` chunk and closes. A failed stream sends a terminal non-nil `Err` and closes, without reporting successful completion. On cancellation, prompt closure is sufficient: the consumer checks `ctx.Err()`. Closure without a terminal result or cancellation is an incomplete-stream error.
- The implementation owns sending and closing the channel. The consumer never closes it. Every blocking send must also select on `ctx.Done()` so abandoning a cancelled turn cannot leak a goroutine.

These are requirements for the pending implementation, not existing inference behavior. Error classification must also be agreed in `model/model.go` before integrating the real client: callers need to distinguish an unreachable model from a bad HTTP/SSE response without parsing error strings. Preserve context errors for `errors.Is`; the match handler maps model errors to the protocol codes below.

Wire structs belong in `internal/protocol/` and must mirror [PROTOCOL.md](../PROTOCOL.md), including the `{ type, payload }` envelope and JSON field names. The match handler retains `match_id`, `turn_id`, `phase`, and `deadline`, converts inference inputs to `model.TurnRequest`, and attaches `turn_id` when forwarding chunks as `MATCH_RESPONSE`. Neither the model client nor Ollama lifecycle code imports match or connection code. Game rules and prompt construction remain on the server.

### Context and concurrency ownership

`cmd/bilc/run.go` owns the application context and service cleanup. Connection/session, match, and turn contexts derive from it; the match handler uses the server's turn deadline and retains the cancel function for `MATCH_END`/`FORFEIT`. A lost connection cancels in-flight match work. Each context creator calls its cancel function when its work ends. Cancelling a turn must not stop the Ollama service.

The model implementation passes the supplied turn context to HTTP requests and observes cancellation during channel sends. The match handler distinguishes deadline expiry (`MODEL_TIMEOUT`) from deliberate cancellation after match end/shutdown, discards late output from cancelled turns, and waits for turn workers to exit. The socket reader stays responsive during generation; all outgoing frames use one writer. Startup integration must also monitor `Service.Wait` alongside match serving so an owned Ollama process exit still ends the run with an error.

Initial scope is local Ollama only, accessed through OpenAI Chat Completions (`POST {base_url}/chat/completions`, `stream: true`). Other inference backends are deferred. On startup, reuse a responding local Ollama service; otherwise start the installed `ollama serve` executable and wait for readiness. Stop only a process BILC started when shutting down. Installing Ollama and downloading models are outside the initial scope.

Implemented lifecycle: check `http://127.0.0.1:11434/api/version` with a 500 ms request timeout; otherwise start `ollama serve` from PATH. The child inherits local settings such as `OLLAMA_MODELS`, with `OLLAMA_HOST` pinned to `127.0.0.1:11434`; custom hosts are deferred. Startup has a 15 s deadline. Invalid HTTP responses fail explicitly. BILC detects an owned process exiting, and always waits for it during cleanup. Cancellation sends an interrupt where supported, falling back to a kill on unsupported platforms or after 3 s. Existing services are never stopped. These readiness checks do not load a model or run inference.

Error mapping: model unreachable → `MODEL_UNAVAILABLE`; non-2xx or malformed stream → `MODEL_ERROR`; deadline passed → `MODEL_TIMEOUT`. `MATCH_ASSIGN` while busy → `BILC_BUSY`.

## Commands

| Command | Does |
|---|---|
| `bilc help`, `bilc --help`, `bilc -h`, or no arguments | Show help (implemented) |
| `bilc version`, `bilc --version` | Print version (implemented; currently `dev`) |
| `bilc run --help` | Show command usage and flags (implemented) |
| `bilc pair <code>` | Register with a code from the web app's `/bilc` page |
| `bilc model set --url <base_url> --model <name>` | Configure the local model; verifies it responds |
| `bilc run` | Ensure local Ollama is ready and wait until Ctrl-C (implemented); connect and serve matches, sending `DISCONNECT` on exit (planned) |
| `bilc status` | Paired?, model reachable?, server reachable?, version |
| `bilc update` | Update now |
| `bilc unpair` | Delete local credentials (revoke from the web app too) |

Help and version go to stdout; progress and errors go to stderr. Invalid commands, flags, and unexpected positional arguments exit nonzero. Ctrl-C and SIGTERM perform cleanup and exit successfully; startup failure or an unexpected owned process exit returns nonzero. Output is short and human-readable. Never print tokens, codes after use, or prompt contents (log sizes and IDs only). `bilc run --verbose` adds startup timing. Raw Ollama process logs are not forwarded.

## Pairing and auth flow

1. User clicks "Pair device" at `/bilc` in the web app → `POST /v1/bilc/pairing-codes` → 8-char code, valid 10 min, single use.
2. `bilc pair <code>` → `POST /v1/bilc/register` → `bilc_id` + refresh token.
3. Store the refresh token in the OS keychain (`go-keyring`). If there's no keychain, use a file in the config dir with mode `0600`, and warn.
4. `bilc run` → `POST /v1/bilc/token` → 15-min access JWT + a **new** refresh token, which replaces the stored one before any other step.
5. Dial the WebSocket with `Authorization: Bearer <jwt>`. Refresh before `expires_at` and on 4401, then reconnect.
6. `TOKEN_INVALID` or 4403 (revoked) → stop, delete credentials, and tell the user to re-pair.

## Config

`os.UserConfigDir()/chickenfaight/bilc/config.json` holds `server_url` (default: production), `model.base_url`, `model.name`, and `bilc_id`. It never holds secrets. If `model.base_url` is not a loopback address, warn on every start: prompts leave the machine.

## Updates

GitHub Releases, built by GoReleaser. It's the common setup for Go CLIs and needs no infrastructure of our own.

- Release CI builds `mac|win|linux` × `amd64|arm64` static binaries plus `checksums.txt`, and signs `checksums.txt` with an ed25519 key held in CI secrets. The public key is compiled into BILC.
- UpdateManager calls `GET /v1/bilc/releases/latest` on start and every 24 h. If the running version is below `min_supported_version`, refuse to serve matches and prompt `bilc update`. If it's only below `version`, print a notice.
- `bilc update` (via `go-selfupdate`) downloads the asset, verifies the signature on `checksums.txt` and the asset's SHA-256, then replaces the binary. Any verification failure aborts with no change.
- Never update automatically mid-match. `bilc run` may update between matches only if the user passed `--auto-update`.
- A 426 or `BILC_OUTDATED` from the server always means "run `bilc update`".
