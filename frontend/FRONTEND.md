# Frontend

Next.js (App Router) + React + TypeScript + Tailwind v4, managed with `pnpm`. Desktop web only. Contracts are in [PROTOCOL.md](../PROTOCOL.md).

This Next.js version differs from most training data. Read the relevant guide in `node_modules/next/dist/docs/` before using a Next API (see the block in `AGENTS.md` here).

## Visual language

`app/components/lobby.tsx` is the homepage reference: a playful charcoal lobby with chicken-comb red actions, horizontal navigation, and a top-right profile dropdown (hover, click, and keyboard). Login shares the lobby palette, typography, and wordmark, with a short game introduction and Google sign-in card. `app/health/page.tsx` is a dev tool.

The lobby and login use a #17181b canvas, #202124 panels, warm white type, subtle borders, and #e53848 primary actions with #f04b58 accents. Small amber/lavender card icons and a chicken wordmark add personality. Other screens retain the black/zinc palette below.

| Element | Classes |
|---|---|
| Page | `min-h-svh bg-black text-white font-sans` |
| Header / footer padding | `px-6 py-7 sm:px-10` |
| Wordmark | `text-sm font-semibold tracking-tight`: `chickenfaight` + `<span className="text-zinc-500">.</span>` |
| Card / panel | `rounded-3xl border border-white/10 bg-gradient-to-b from-zinc-900/70 to-zinc-950/50` |
| Inset (panel inside a card) | `rounded-xl border border-white/10 bg-black/40` |
| Eyebrow label | `text-[10px] font-medium tracking-[0.25em] uppercase text-zinc-500` |
| Headline | `text-4xl font-medium tracking-[-0.045em]` |
| Body / secondary / faint text | `text-white` / `text-zinc-400` / `text-zinc-500`, small print `text-xs` |
| Primary button (one per view) | `min-h-12 rounded-xl bg-white px-4 py-3 text-sm font-medium text-zinc-950 hover:bg-zinc-200` |
| Secondary button | `rounded-full border border-white/20 px-5 py-2.5 text-white hover:bg-white/10` |
| Text link | `text-xs text-zinc-400 hover:text-white` |
| Focus (every interactive element) | `focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white` |
| Transitions | `transition-colors` only |
| Footer | `text-[10px] tracking-[0.2em] uppercase text-zinc-600` |

Color with meaning (the only colors besides black/white/zinc):

| Meaning | Color | Use |
|---|---|---|
| Side `pro` | `sky-300` | Borders, labels, small dots. Never fills or large text blocks. |
| Side `con` | `amber-300` | Same |
| Online / success | `emerald-400` dot with `shadow-[0_0_12px_rgba(52,211,153,0.8)]` | Status indicators |
| Offline / error | `red-400` dot with `shadow-[0_0_12px_rgba(248,113,113,0.8)]` | Status indicators, error text `text-red-300` |

Add side colors as `--side-pro` / `--side-con` tokens in `globals.css` the first time they're used, and reference the tokens after that.

Lobby and login exceptions: colored action fills, small SVG icons, and compact result badges are allowed. No hero artwork, paid features, sidebar, or hamburger menu.

Do not: add light mode; use colored or gradient fills (no purple/indigo/blue "AI" gradients); add drop shadows other than the status glows; use emoji or decorative icons; add fonts other than Geist Sans/Mono; add a component library (shadcn, MUI, etc.); use `rounded-md`/`rounded-lg` (use `xl`, `3xl`, or `full`).

## Usability

- Design for ≥ 1280 px wide; don't break at 1024 px. No mobile layouts.
- Every data view has loading, empty, and error states (see `login-status.tsx`): short, lowercase-ish, `text-zinc-500`.
- Status changes use `aria-live="polite"`. Streaming model text does not.
- Every control is keyboard reachable with the focus style above. Headings via `aria-labelledby` on sections.
- Show deadlines as live countdowns from the server's `deadline`; never trust a local timer as authoritative.
- Model output and prompts render as plain text (`whitespace-pre-wrap`). Never `dangerouslySetInnerHTML`, never Markdown.
- Copy is short and plain. "Match" in code, "debate" in UI.

## Screens

| Route | Screen | Status |
|---|---|---|
| `/login` | Google sign-in | implemented |
| `/health` | Backend check (dev) | implemented |
| `/` | Desktop lobby: queue registration/status polling, session/profile menu, sample stats and activity cards | implemented (matchmaking integration; sample stats) |
| `/play` | Game selection | PLANNED |
| `/match/[id]` | Debate view | PLANNED |
| `/leaderboard` | Per-ladder leaderboard, ladder switcher | PLANNED |
| `/profile/[id]` | Username, avatar, rating per ladder, match history | PLANNED |
| `/bilc` | Pair a device (show code), device list with online dots, revoke, setup steps | PLANNED |

**Homepage (`/`).** Join game checks for an existing queue entry or match before registering through the current `POST /v1/match/queue` route. On mount and before registration, the queue card reads `GET /v1/match/status`; queued users are polled sequentially every second. A matched response stops polling and displays the match ID without navigation or WebSockets. Requests time out, are aborted on unmount, and failures keep the Join game action available; retrying checks status first and registers only when the server confirms no existing entry. The model selector shows the backend's single provided model. Cancel queue stops polling and calls `DELETE /v1/match/queue`; HTTP 204 returns to idle, while `IN_MATCH` refreshes status to show the match. Errors retain the same Join game recovery action. Leaving the page does not cancel a queue entry. The elapsed timer is local to this page, not an authoritative server timestamp. Statistics are illustrative. Session identity comes from `/auth/me`, with guest/loading/error states and sign-out via `/auth/logout`. Activity cards open informational dialogs until those features ship.

**Tag dialog (`username-dialog.tsx`).** Shown by the lobby if and only if the signed-in user's `username` is null. It is a blocking modal: Escape and closing are refused, and the only ways out are claiming a tag or signing out. The input checks the format rule locally on every keystroke, and after a 350 ms pause asks `GET /api/v1/users/username-availability` (aborting stale requests) for taken/profanity results. Submit stays disabled while the format is invalid or the tag is known to be unavailable; `PATCH /api/v1/users/me` rejections are shown inline. Copy warns that the tag can't be changed.

**Game selection (`/play`).** A card listing ladders (cloud models and the BYOM arena), each showing your Elo on it. BYOM requires choosing one of your online devices; offline devices are shown but disabled with a link to `/bilc`. One primary "Find match" button. While queued: elapsed time and a secondary "Cancel". On `matched`, navigate to `/match/[id]`.

**Debate view (`/match/[id]`).** Topic as the headline. Two columns, `pro` left and `con` right, each headed by the player's name, Elo, and side color. Before turns: a prompt box for your side only (character counter to 2000, one submit, then locked) with a countdown and the opponent's ready state. During turns: each column fills with its turns under phase eyebrows (`opening`, `rebuttal`, `closing`), streaming live. After: a verdict panel spanning both columns with the winner, the judge's reasoning, and Elo change per player (or the forfeit/void reason), plus a link back to `/play`.

## Code conventions

- Routes in `app/<route>/page.tsx`. Server Components by default; add `"use client"` only for state, effects, or browser APIs, as low in the tree as possible.
- Shared components in `app/components/`, one per file, kebab-case filename, default-exported PascalCase component.
- Non-UI code in `app/lib/`: `auth.ts` (`backendUrl`), `api.ts` (one fetch wrapper: `credentials: "include"`, timeout, optional JSON body, parses the PROTOCOL error envelope into `ApiError { status, code, detail }`), `protocol.ts` (TypeScript types mirroring PROTOCOL.md, kept in sync by hand).
- Never hard-code the backend URL; use `backendUrl`. Env vars exposed to the browser must be `NEXT_PUBLIC_*` and must not be secrets.
- Every fetch/socket/timer is cleaned up on unmount (`AbortController`, `close()`), as in `login-status.tsx`.
- Style with Tailwind classes inline. No CSS modules or new global CSS beyond tokens in `globals.css`.

## State (React Context)

- Server data that a single page needs: fetch in a Server Component or local `useState`. No context.
- Context is for state shared across a subtree that changes over time. Planned contexts:
  - `SessionContext` (app-wide): current user or null, `refresh()`, `logout()`. Provider in the root layout. Replaces per-component `/auth/me` calls.
  - `MatchContext` (inside `/match/[id]` only): owns the match WebSocket, a reducer over PROTOCOL messages, and `submitPrompt()`/`resign()`. No component other than its provider touches the socket.
- One context per concern, in `app/components/providers/<name>-provider.tsx`, exporting the provider and a `use<Name>()` hook that throws outside its provider.
- Keep context values stable (`useMemo`/`useReducer`); put fast-changing streaming text in the reducer, not in many `useState`s.
- No external state libraries.

## Checks

Before finishing: `pnpm lint` and `pnpm build` pass, and the change was used in a browser (see [TESTING.md](../TESTING.md)).
