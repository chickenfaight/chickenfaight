# BILC — BYOM Interface Layer Client

A Go CLI on the user's machine that connects their local LLM to the server so it can compete in the BYOM arena. It keeps one WebSocket open to the server and forwards each `TURN_REQUEST` to the local model, streaming the output back. Every message and endpoint it uses is defined in [PROTOCOL.md](../PROTOCOL.md). Do not invent any others.

Implemented: the CLI, Ollama lifecycle, pairing and token rotation (`pair`, `unpair`, `status`), model config (`model set`), the connection, and match play: `bilc run` connects and plays its model's turns in BYOM matches until Ctrl-C. Also release builds and `install.sh`/`uninstall.sh`. Still planned: `bilc update`, signed releases, and phases after `opening` (the server only sends opening turns so far).

## Principles

- **Dumb pipe.** BILC forwards server-built `messages` to the model unchanged and returns output unchanged. Game logic stays on the server.
- **The server never controls the machine.** BILC only calls the model URL from local config; nothing from the server can change it, name a file, or run a command.
- **Fail loudly, fail contained.** A model error ends that turn with `ERROR`, not the process. A crash in one match never corrupts auth or config.
- **Everything blocking takes a `context.Context`** with a deadline, and is cancelled on `MATCH_END`, `FORFEIT`, or shutdown.

## Layout

```
bilc/
  cmd/bilc/main.go        CLI entry: parses commands, wires components
  cmd/bilc/commands.go    pair, unpair, status, model set
  cmd/bilc/run.go         signal context, Ollama lifecycle, and the connection
  internal/ollama/        local service readiness and owned process cleanup
  internal/model/         model contract; OpenAI-compatible streaming client (openai.go)
  internal/config/        config file load/save
  internal/auth/          Auth: REST client, token rotation, credential store
  internal/conn/          ConnectionManager
  internal/match/         MatchHandler
  internal/update/        PLANNED: UpdateManager
  internal/protocol/      message structs mirroring PROTOCOL.md
  .goreleaser.yaml        release builds (see "Updates")
  install.sh              install or update on Linux/macOS
  uninstall.sh            remove; --purge also unpairs and deletes config
```

Standard library first. Allowed third-party packages: a WebSocket library (`github.com/coder/websocket`), `github.com/zalando/go-keyring`, `github.com/creativeprojects/go-selfupdate`, `golang.org/x/sync/errgroup`. Anything else needs a reason in the PR. Code must pass `gofmt`, `go vet`, and `go test -race ./...`. No package-level mutable state.

## Components

Responsibilities follow the design doc's class diagram. Package boundaries may flex, but each responsibility has exactly one owner.

| Component | Owns | Does not |
|---|---|---|
| **Auth** | Pairing (`/v1/bilc/register`), refresh→access token exchange (`/v1/bilc/token`), storing `bilc_id` + refresh token, refreshing the JWT before expiry (implemented) | Touch the socket or model |
| **ConnectionManager** | Dial `/v1/bilc/ws` with the JWT, send `HELLO`, wait for `HELLO_ACK`, echo heartbeats, reconnect with exponential backoff (1 s → 30 s, with jitter), a single writer goroutine, close codes (implemented) | Interpret match messages |
| **ModelInterface** | Talking to the local model (implemented) | Know about matches or the server |
| **MatchHandler** | Handling `MATCH_ASSIGN`/`TURN_REQUEST`/`MATCH_END`/`FORFEIT`, one match at a time, per-turn deadlines, streaming `MATCH_RESPONSE`, mapping model failures to `ERROR` codes (implemented) | Retry a failed turn (the server decides outcomes) |
| **UpdateManager** | Version checks and self-update | Update during a match |

```go
type Model interface {
    Info(ctx context.Context) (ModelInfo, error)                  // name, context length, metadata for HELLO
    Stream(ctx context.Context, req TurnRequest) (<-chan Chunk, error)
}
```

## Integration contract

Match-handler tests use a fake implementing `model.Model`; neither Ollama nor completed auth is needed. Connection tests use a fake WebSocket server and test credentials. To try the whole path locally, pair against your local backend and `ollama pull` a small model; do not bypass server authentication.

### Shared model contract

`internal/model/model.go` defines `Model`, `Message`, `TurnRequest`, `ModelInfo`, and `Chunk`. These types form the boundary between inference and match handling:

- `TurnRequest` contains only `Messages` and `MaxTokens`. The local client selects its configured model and URL. Forward message roles, content, and order unchanged; do not mutate the request after passing it to `Stream`.
- `ModelInfo` supplies name, optional context length (`nil` means unknown), and metadata for `HELLO`. It is not itself a wire payload.
- `Chunk` contains `Delta`, `Done`, nullable `FinishReason`, and `Err`. The consumer processes any `Delta` before completion. No reasoning text is forwarded.
- `Stream` returns `nil, err` if setup fails, otherwise a non-nil receive-only channel and `nil`. Failures after return arrive in `Chunk.Err`.
- A successful stream sends exactly one terminal `Done: true` chunk and closes. A failed stream sends a terminal non-nil `Err` and closes, without reporting successful completion. On cancellation, prompt closure is sufficient: the consumer checks `ctx.Err()`. Closure without a terminal result or cancellation is an incomplete-stream error.
- The implementation owns sending and closing the channel. The consumer never closes it. Every blocking send must also select on `ctx.Done()` so abandoning a cancelled turn cannot leak a goroutine.

`model.OpenAI` (`openai.go`) implements this. Failures wrap `model.ErrUnavailable` (unreachable) or `model.ErrBadResponse` (non-2xx, malformed, error event, or a stream that ends without `[DONE]` or a finish reason), so callers use `errors.Is` rather than parsing strings; context errors are kept. Only `delta.content` is forwarded, never reasoning fields. `Info` asks Ollama's `POST /api/show` (the base URL without `/v1`) for `parameter_size`, `quantization_level`, `family`, and the context length, which go into `HELLO`; a missing model fails `bilc run` with "run `ollama pull <name>`", and a server without that API gives no size (the server then counts it as large). `Warm` (`POST /api/generate` with `keep_alive`) loads the model when `MATCH_ASSIGN` arrives, so the first turn doesn't wait for it.

Wire structs belong in `internal/protocol/` and must mirror [PROTOCOL.md](../PROTOCOL.md), including the `{ type, payload }` envelope and JSON field names. The match handler retains `match_id`, `turn_id`, `phase`, and `deadline`, converts inference inputs to `model.TurnRequest`, and attaches `turn_id` when forwarding chunks as `MATCH_RESPONSE`. A `TURN_REQUEST` before any `MATCH_ASSIGN` (a restart mid-match) adopts its match; one for another match, or a second turn at once, gets `ERROR` `BILC_BUSY`. A repeated `MATCH_ASSIGN` for the current match (after a reconnect) is accepted quietly. Neither the model client nor Ollama lifecycle code imports match or connection code; the connection passes match messages to the handler through `conn.MessageHandler`. Game rules and prompt construction remain on the server.

### Context and concurrency ownership

`cmd/bilc/run.go` owns the application context and service cleanup. Connection/session, match, and turn contexts derive from it; the match handler uses the server's turn deadline and retains the cancel function for `MATCH_END`/`FORFEIT`. A lost connection cancels in-flight match work. Each context creator calls its cancel function when its work ends. Cancelling a turn must not stop the Ollama service.

The model implementation passes the supplied turn context to HTTP requests and observes cancellation during channel sends. The match handler distinguishes deadline expiry (`MODEL_TIMEOUT`) from deliberate cancellation after match end/shutdown, discards late output from cancelled turns, and waits for turn workers to exit. The socket reader stays responsive during generation; all outgoing frames use one writer. Startup integration must also monitor `Service.Wait` alongside match serving so an owned Ollama process exit still ends the run with an error.

Initial scope is local Ollama only, accessed through OpenAI Chat Completions (`POST {base_url}/chat/completions`, `stream: true`). Other inference backends are deferred. On startup, reuse a responding local Ollama service; otherwise start the installed `ollama serve` executable and wait for readiness. Stop only a process BILC started when shutting down. Installing Ollama and downloading models are outside the initial scope.

Implemented lifecycle: check `http://127.0.0.1:11434/api/version` with a 500 ms request timeout; otherwise start `ollama serve` from PATH. The child inherits local settings such as `OLLAMA_MODELS`, with `OLLAMA_HOST` pinned to `127.0.0.1:11434`; custom hosts are deferred. Startup has a 15 s deadline. Invalid HTTP responses fail explicitly. BILC detects an owned process exiting, and always waits for it during cleanup. Cancellation sends an interrupt where supported, falling back to a kill on unsupported platforms or after 3 s. Existing services are never stopped. These readiness checks do not load a model or run inference.

Error mapping (implemented): model unreachable → `MODEL_UNAVAILABLE`; non-2xx or malformed stream → `MODEL_ERROR`; deadline passed → `MODEL_TIMEOUT`. `MATCH_ASSIGN` while busy → `BILC_BUSY`. A turn cancelled by `MATCH_END`, `FORFEIT`, a lost connection, or Ctrl-C sends nothing more.

## Commands

| Command | Does |
|---|---|
| `bilc help`, `bilc --help`, `bilc -h`, or no arguments | Show help (implemented) |
| `bilc version`, `bilc --version` | Print version (implemented; currently `dev`) |
| `bilc run --help` | Show command usage and flags (implemented) |
| `bilc pair <code> [--server URL] [--name NAME]` | Register with a code from the web app's `/bilc` page; refuses if already paired (implemented) |
| `bilc model set --model <name> [--url <base_url>]` | Configure the local model; `--url` defaults to local Ollama's `http://127.0.0.1:11434/v1` (implemented). `bilc run` checks the model is installed; checking here too is PLANNED |
| `bilc run` | Ensure local Ollama is ready, check the model is installed, connect, and play BYOM matches until Ctrl-C, sending `DISCONNECT` on exit (implemented). Needs pairing and a model. Logs match start and end and turn sizes, never prompts |
| `bilc status` | Version, server reachable, and whether the server still accepts the device (a token refresh) (implemented); model reachable is PLANNED |
| `bilc update` | Update now (PLANNED; re-run `install.sh` meanwhile) |
| `bilc unpair` | Delete local credentials (revoke from the web app too) (implemented) |

Flags may come before or after positional arguments.

Help and version go to stdout; progress and errors go to stderr. Invalid commands, flags, and unexpected positional arguments exit nonzero. Ctrl-C and SIGTERM perform cleanup and exit successfully; startup failure or an unexpected owned process exit returns nonzero. Output is short and human-readable. Never print tokens, codes after use, or prompt contents (log sizes and IDs only). `bilc run --verbose` adds startup timing. Raw Ollama process logs are not forwarded.

## Pairing and auth flow

1. User clicks "Pair device" at `/bilc` in the web app → `POST /v1/bilc/pairing-codes` → 8-char code, valid 10 min, single use.
2. `bilc pair <code>` → `POST /v1/bilc/register` → `bilc_id` + refresh token.
3. Store the refresh token in the OS keychain (`go-keyring`, service `chickenfaight-bilc`). If there's no keychain, use `credentials.json` in the config dir with mode `0600`, and warn once. Saving to one place deletes any copy in the other, so a stale token is never read first.
4. `bilc run` → `POST /v1/bilc/token` → 15-min access JWT + a **new** refresh token, which replaces the stored one before any other step.
5. Dial the WebSocket with `Authorization: Bearer <jwt>`. Refresh before `expires_at` (a minute early, when reconnecting) and on any rejection: 4401, 4403, or an HTTP 401/403 handshake failure, since the server rejects before accepting (PROTOCOL.md). A live socket isn't closed when its JWT expires.
6. `TOKEN_INVALID` → stop, delete credentials and `bilc_id`, and tell the user to re-pair. A revoked device reaches this on the refresh after its 4403. 4426 → stop with "run `bilc update`"; 4409 → stop, since another BILC is using these credentials.

## Config

`os.UserConfigDir()/chickenfaight/bilc/config.json` (mode `0600`, directory `0700`) holds `server_url`, `model.base_url`, `model.name`, and `bilc_id`. It never holds secrets. `server_url` defaults to `main.defaultServerURL`: `http://localhost:8000`, or the `BILC_SERVER_URL` repository variable in release builds. If `model.base_url` is not a loopback address, warn on every start: prompts leave the machine. If `server_url` is plain `http://` to another machine, warn that credentials travel unencrypted.

## Updates

GitHub Releases, built by GoReleaser. It's the common setup for Go CLIs and needs no infrastructure of our own.

- Release CI (implemented, `.github/workflows/bilc-release.yml`) runs on a `bilc/vMAJOR.MINOR.PATCH` tag: it runs the checks, builds `darwin|windows|linux` × `amd64|arm64` static binaries as `bilc_<os>_<arch>.tar.gz` (`.zip` on Windows) plus `checksums.txt`, checks `install.sh` against them, and publishes a GitHub Release with `gh`. GoReleaser only builds: its free version can't parse `bilc/`-prefixed tags, so the workflow passes it `v<version>`. To release, push a tag: `git tag bilc/v0.1.0 && git push origin bilc/v0.1.0`. Signing `checksums.txt` with an ed25519 key held in CI secrets, with the public key compiled into BILC, is PLANNED.
- `install.sh` (implemented) detects Linux/macOS and amd64/arm64, downloads the latest release's archive and `checksums.txt` (or `BILC_VERSION`'s), verifies the SHA-256, and installs to `BILC_INSTALL_DIR` (default `~/.local/bin`) by renaming over the old binary. Re-running it updates; the same version is left alone. It assumes only BILC publishes GitHub Releases in this repo, so "latest" is BILC's. `uninstall.sh` removes the binary; `--purge` runs `bilc unpair` and deletes the config directory.
- UpdateManager calls `GET /v1/bilc/releases/latest` on start and every 24 h. If the running version is below `min_supported_version`, refuse to serve matches and prompt `bilc update`. If it's only below `version`, print a notice.
- `bilc update` (via `go-selfupdate`) downloads the asset, verifies the signature on `checksums.txt` and the asset's SHA-256, then replaces the binary. Any verification failure aborts with no change.
- Never update automatically mid-match. `bilc run` may update between matches only if the user passed `--auto-update`.
- A 426 or `BILC_OUTDATED` from the server always means "run `bilc update`".
