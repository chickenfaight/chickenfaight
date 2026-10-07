# Frontend

Next.js (App Router) + React + TypeScript + Tailwind v4, managed with `pnpm`. Desktop web only. Contracts are in [PROTOCOL.md](../PROTOCOL.md).

This Next.js version differs from most training data. Read the relevant guide in `node_modules/next/dist/docs/` before using a Next API (see the block in `AGENTS.md` here).

## Visual language

`app/components/lobby.tsx` is the homepage reference: a playful charcoal lobby with chicken-comb red actions, horizontal navigation, and a top-right profile dropdown (hover, click, and keyboard). Login shares the lobby palette, typography, and wordmark, with a short game introduction and Google sign-in card. `app/health/page.tsx` is a dev tool.

The lobby, login, search, and profile screens use a #17181b canvas, #202124 panels, warm white type, subtle borders, and #e53848 primary actions with #f04b58 accents. Small amber/lavender card icons and a chicken wordmark add personality. The match arena uses a #15181b canvas, #1c1f22 verdict panels, the same warm white type and red actions, and sky/amber side labels. Other screens retain the black/zinc palette below.

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

Lobby, login, and match arena exceptions: colored action fills, small SVG icons, and compact result badges are allowed. No hero artwork, paid features, sidebar, or hamburger menu. The arena follows the supplied visual references with 12–16px panel corners; its submission transition animates layout and prompt position for 650–700ms, respecting reduced motion.

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
| `/match/[match_id]` | Debate arena | implemented |
| `/leaderboard` | Per-ladder leaderboard, ladder switcher | PLANNED |
| `/search` | Player search results by tag, infinite scroll | implemented |
| `/profile/[username]` | Tag, avatar, win rate; `/profile/me` redirects to your own. Rating per ladder and match history PLANNED | implemented |
| `/bilc` | Pair a device (show code), device list with online dots, revoke, setup steps | PLANNED |

**Homepage (`/`).** Join game checks for an existing queue entry or match before registering through the current `POST /v1/match/queue` route. On mount and before registration, the queue card reads `GET /v1/match/status`; queued users are polled sequentially every second. A matched response stops polling and navigates to `/match/[match_id]`, which opens the match WebSocket. Requests time out, are aborted on unmount, and failures keep the Join game action available; retrying checks status first and registers only when the server confirms no existing entry. The model selector shows the backend's single provided model. Cancel queue stops polling and calls `DELETE /v1/match/queue`; HTTP 204 returns to idle, while `IN_MATCH` refreshes status to show the match. Errors retain the same Join game recovery action. Leaving the page does not cancel a queue entry. The elapsed timer is local to this page, not an authoritative server timestamp. Statistics are illustrative. Activity cards open informational dialogs (`info-dialog.tsx`) until those features ship.

**Header (`site-header.tsx`).** Shared by the lobby, search, and profile: wordmark, Play (underlined only on `/`), Leaderboards and How to play (informational dialogs for now), player search, and the profile menu (hover, click, keyboard) with My profile, My ladder, and Sign out. Identity comes from `useSession()`, with guest/loading/error states.

**Tag dialog (`username-dialog.tsx`).** Shown by the lobby if and only if the signed-in user's `username` is null. It is a blocking modal: Escape and closing are refused, and the only ways out are claiming a tag or signing out. The input checks the format rule locally on every keystroke, and after a 350 ms pause asks `GET /v1/users/username-availability` (aborting stale requests) for taken/profanity results. Submit stays disabled while the format is invalid or the tag is known to be unavailable; `PATCH /v1/users/me` rejections are shown inline. Copy warns that the tag can't be changed.

**Player search (`user-search.tsx`).** A combobox in `site-header.tsx`. After a 200 ms pause it asks `GET /v1/users/search` for 5 suggestions (aborting stale requests), only while its list is open. Arrow keys move through the suggestions, Enter opens the highlighted profile or else `/search?q=`, and Escape closes the list. The list shows searching/no-match/error text in an `aria-live` line. `/search` loads 20 results per page and fetches the next page when a sentinel nears the viewport; a blank query shows a prompt instead of searching.

**Profile (`/profile/[username]`).** A Server Component that forwards the session cookie to `GET /v1/users/by-username/{username}`. 401 redirects to `/login`; an unknown or malformed tag shows "Player not found"; other failures show "Profile unavailable". It shows only `UserProfile` fields. On other players' profiles, `add-friend.tsx` toggles Add friend / Remove friend (`PUT`/`DELETE /v1/friends/{user_id}`), starting from `is_friend` and showing inline errors, including a wait message on 429. On your own profile, a Friends panel lists your first 100 friends from `GET /v1/friends`, with empty and error states. Win rate sums `ratings` and shows "No debates yet." while there are none. `avatar.tsx` renders Google avatars (the only host in `next.config.ts`) and falls back to initials.

**Game selection (`/play`).** A card listing ladders (cloud models and the BYOM arena), each showing your Elo on it. BYOM requires choosing one of your online devices; offline devices are shown but disabled with a link to `/bilc`. One primary "Find match" button. While queued: elapsed time and a secondary "Cancel". On `matched`, navigate to `/match/[match_id]`.

**Debate view (`/match/[match_id]`).** A separate arena with only a slim wordmark/status header. Initially, the topic and full assigned position sit above a centered prompt editor, character counter, server deadline countdown, and red submit button. Submission replaces the editor with plain text that slides up as the topic shrinks and moves up. The player's argument streams beneath it. `TURN_END` shows a waiting-for-opponent panel; `JUDGING` changes only its message. The result shows the winner and reason above equal-width own/opponent argument tabs, retaining the player's private prompt only in their own tab. Return links lead to the lobby. Errors and loading are inline; no reconnect or persisted match history is implemented. Prompts remain only in page memory.

## Code conventions

- Routes in `app/<route>/page.tsx`. Server Components by default; add `"use client"` only for state, effects, or browser APIs, as low in the tree as possible.
- Shared components in `app/components/`, one per file, kebab-case filename, default-exported PascalCase component.
- Non-UI code in `app/lib/`: `auth.ts` (`backendUrl`), `api.ts` (one fetch wrapper: `credentials: "include"`, timeout, optional JSON body, parses the PROTOCOL error envelope into `ApiError { status, code, detail }`), `protocol.ts` (TypeScript types mirroring PROTOCOL.md, kept in sync by hand).
- Never hard-code the backend URL; use `backendUrl`. Env vars exposed to the browser must be `NEXT_PUBLIC_*` and must not be secrets.
- Every fetch/socket/timer is cleaned up on unmount (`AbortController`, `close()`), as in `login-status.tsx`.
- Style with Tailwind classes inline. No CSS modules or new global CSS beyond tokens in `globals.css`.

## State (React Context)

- Server data that a single page needs: fetch in a Server Component or local `useState`. No context.
- Context is for state shared across a subtree that changes over time. Contexts:
  - `SessionContext` (app-wide, implemented in `session-provider.tsx`): current user or null, session status, `setUser()`, `logout()`. Provider in the root layout. Replaces per-component `/auth/me` calls (`login-status.tsx` on `/health` still makes its own).
  - `MatchContext` (implemented, inside `/match/[match_id]` only): owns one match WebSocket, heartbeat echo and cleanup, a reducer over current PROTOCOL messages, and `submitPrompt()`. No component other than its provider touches the socket; resignation is not implemented.
- One context per concern, in `app/components/providers/<name>-provider.tsx`, exporting the provider and a `use<Name>()` hook that throws outside its provider.
- Keep context values stable (`useMemo`/`useReducer`); put fast-changing streaming text in the reducer, not in many `useState`s.
- No external state libraries.

## Checks

Before finishing: `pnpm lint` and `pnpm build` pass, and the change was used in a browser (see [TESTING.md](../TESTING.md)).
