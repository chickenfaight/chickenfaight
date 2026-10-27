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
| `/login` | Google sign-in, or tag and password (`login-form.tsx`); links to `/signup`; redirects to `/` when the session is already valid | implemented |
| `/settings` | Account details (tag, username, email) and Delete account with an "Are you sure?" dialog (`account-settings.tsx`); deletion calls `DELETE /v1/users/me`, refreshes the session, and goes to `/login` | implemented |
| `/challenge` | Today's daily challenge (`daily-challenge.tsx`): topic, both positions, twist, reward, time until the UTC reset, and either "Completed today" or `MatchmakingCard daily`, which queues with `daily: true` | implemented |
| `/tips` | Debate tips (`tips-chat.tsx`): a streamed chat with a coach running on the chosen arena model, with the predefined tips as starter buttons. The conversation lives only in page state and is sent whole with each message. Client caps mirror the server's (2,000 characters per message, 8,000 total, 20 messages), with a New chat button. Model output is shown as plain text. The model defaults to the lobby's last choice (`lib/selected-arena.ts`, stored in `localStorage` with guarded access) | implemented |
| `/signup` | Tag, username, password, and confirmation (`signup-form.tsx`). Rules are checked as you type (tag format, username 1–32, password 8–128, matching confirmation) and again by the server; `TAG_*`/`USERNAME_*` errors appear under their field. Success signs in and goes to `/`. Tag availability is only known on submit, because the availability check requires a session. Redirects to `/` when already signed in | implemented |
| `/health` | Backend check (dev) | implemented |
| `/` | Desktop lobby: queue registration/status polling, session/profile menu, sample stats and activity cards | implemented (matchmaking integration; sample stats) |
| `/play` | Game selection | PLANNED |
| `/match/[match_id]` | Debate arena | implemented |
| `/leaderboard` | Per-ladder leaderboard, ladder switcher | PLANNED |
| `/search` | Player search results by tag, infinite scroll | implemented |
| `/profile/[tag]` | Username, tag, avatar, win rate; `/profile/me` redirects to your own. Rating per ladder and match history PLANNED | implemented |
| `/bilc` | Pair a device (`bilc-devices.tsx`): setup steps with the install command, Get pairing code (shows `bilc pair ABCD-EFGH` with a live countdown from the server's `expires_at`), and the caller's devices with online dots, model, platform, version, last seen, and Revoke with a confirm step. The list polls every 3 s while a code is showing, so a newly paired device appears, and every 15 s otherwise | implemented (status beyond online/offline and match history PLANNED) |

**Homepage (`/`).** Join game checks for an existing queue entry or match before registering through the current `POST /v1/match/queue` route. On mount and before registration, the queue card reads `GET /v1/match/status`; queued users are polled sequentially every second. A matched response stops polling and navigates to `/match/[match_id]`, which opens the match WebSocket. Requests time out, are aborted on unmount, and queue failures offer Retry queue status; registration is allowed only after the server confirms no existing entry. The model selector loads the session-authenticated `/v1/arenas` catalog, shows display names, and sends the captured selection as `{ model_id: UUID }`. Choosing the BYOM arena (not offered for the daily challenge) shows a device picker from `GET /v1/bilc/devices`: each device's name, model, and size class, with offline and busy devices listed but disabled, a link to `/bilc` when none is paired, and a refresh hint when none is online; joining sends `{ model_id, bilc_id }`, and `BILC_OFFLINE`, `BILC_BUSY`, or a revoked device reload the list and explain why. Loading, empty, signed-out, and error states prevent joining; catalog errors and empty lists offer retry. A rejected unavailable arena refreshes the catalog. Selection is locked while checking, joining, queued, cancelling, or matched. Recovered queues show an unknown model rather than claiming the default selection; their model is learned from the match socket. Cancel queue stops polling and calls `DELETE /v1/match/queue`; HTTP 204 returns to idle, while `IN_MATCH` refreshes status to show the match. Catalog loading is independent of queue recovery and cancellation. Queue errors offer status retry, plus cancellation when a queue was previously confirmed. Leaving the page does not cancel a queue entry. The elapsed timer is local to this page, not an authoritative server timestamp. Statistics are illustrative. The Daily challenge card links to `/challenge` and shows today's topic and twist, or "Completed today". The other activity cards open informational dialogs (`info-dialog.tsx`) until those features ship. In a daily match, the arena shows the twist above the prompt box, caps the character count at the twist's `max_chars`, and lets the player edit and resubmit after `PROMPT_BREAKS_CHALLENGE`. Profiles show points, plus rank and streak when they apply.

**Auth pages.** `/login` and `/signup` share `auth-layout.tsx`. Both are public: `SessionProvider`'s `PUBLIC_PATHS` lists them, or it would redirect signed-out visitors away from signup.

**Automatic sign-in.** Sessions live in the backend's HTTP-only cookie, never in local storage. `/` and `/login` are Server Components that call `serverSession()` (`lib/server-session.ts`), which asks `GET /auth/me` to validate the cookie: `/` redirects to `/login` when there's no valid session, and `/login` redirects to `/` when there is. If the backend is unreachable, both pages render and show their error states. `SessionProvider` also sends the visitor to `/login` whenever its own `/auth/me` check or a logout leaves the session signed out, except on `/login` and `/health`. Server-side fetches forward the browser's raw `Cookie` header via `forwardedCookie()`: `cookies().toString()` URL-encodes values and breaks the signed cookie.

**App shell and sidebar (`app-shell.tsx`, `sidebar.tsx`).** Signed-in pages (lobby, search, profile, settings, tips, daily challenge, BILC) render inside `AppShell`: the header on top, and a left sidebar linking Play, Daily challenge, Debate tips, BILC, Profile (`/profile/me`), and Settings, with `aria-current` on the active section. Labels collapse to icons below `lg`. Login, signup, and the match arena don't use it.

**Header (`site-header.tsx`).** Shared by the lobby, search, and profile: wordmark, Play (underlined only on `/`), Leaderboards and How to play (informational dialogs for now), player search, and the profile menu (hover, click, keyboard) with My profile, My ladder, and Sign out. Identity comes from `useSession()`, with guest/loading/error states.

**Tag dialog (`tag-dialog.tsx`).** Shown by the lobby if and only if the signed-in user's `tag` is null. It claims the tag with `PUT /v1/users/me/tag`. It is a blocking modal: Escape and closing are refused, and the only ways out are claiming a tag or signing out. The input checks the format rule locally on every keystroke, and after a 350 ms pause asks `GET /v1/users/username-availability` (aborting stale requests) for taken/profanity results. Submit stays disabled while the format is invalid or the tag is known to be unavailable; `PATCH /v1/users/me` rejections are shown inline. Copy warns that the tag can't be changed.

**Player search (`user-search.tsx`).** A combobox in `site-header.tsx`. After a 200 ms pause it asks `GET /v1/users/search` for 5 suggestions (aborting stale requests), only while its list is open. Arrow keys move through the suggestions, Enter opens the highlighted profile or else `/search?q=`, and Escape closes the list. The list shows searching/no-match/error text in an `aria-live` line. `/search` loads 20 results per page and fetches the next page when a sentinel nears the viewport; a blank query shows a prompt instead of searching.

**Profile (`/profile/[tag]`).** A Server Component that forwards the session cookie to `GET /v1/users/by-tag/{tag}`. It shows the username large with the tag beneath; search results, suggestions, and friends lists do the same, and the header and arena show the username. `displayName()` (`lib/protocol.ts`) falls back to the tag for users without a username. 401 redirects to `/login`; an unknown or malformed tag shows "Player not found"; other failures show "Profile unavailable". It shows only `UserProfile` fields, plus your own email on your own profile (from `/auth/me`, marked "only you can see this"). Your own profile also has `profile-editor.tsx`: Change username (rejects blank or over 32 characters before calling `PATCH /v1/users/me`) and Change picture (PNG/JPEG/WebP up to 2 MB with a local preview, uploaded raw to `PUT /v1/users/me/avatar`; Use Google picture removes an upload). Both refresh the session and the page afterwards. `avatar.tsx` shows uploaded pictures from the backend with `unoptimized`, so the browser sends the session cookie that route requires. On other players' profiles, `add-friend.tsx` toggles Add friend / Remove friend (`PUT`/`DELETE /v1/friends/{user_id}`), starting from `is_friend` and showing inline errors, including a wait message on 429. On your own profile, a Friends panel lists your first 100 friends from `GET /v1/friends`, with empty and error states. Win rate sums `ratings` and shows "No debates yet." while there are none. `avatar.tsx` renders Google avatars (the only host in `next.config.ts`) and falls back to initials.

**Game selection (`/play`).** A card listing ladders (cloud models and the BYOM arena), each showing your Elo on it. BYOM requires choosing one of your online devices; offline devices are shown but disabled with a link to `/bilc`. One primary "Find match" button. While queued: elapsed time and a secondary "Cancel". On `matched`, navigate to `/match/[match_id]`.

**Debate view (`/match/[match_id]`).** A separate arena with only a slim wordmark/status header. The server-provided `MATCH_STATE.model_display_name` remains visible above the topic during composition, generation, judging, and results; it is never inferred from lobby selection or browser storage. Before a result, the wordmark opens a "Leave and forfeit?" dialog; confirming calls `resign()`, which waits up to 3 s for `MATCH_RESULT` so the lobby won't send the player back, then navigates to `/`. After a result or a lost connection, the wordmark is a plain link to `/`. Initially, the topic and full assigned position sit above a centered prompt editor, character counter, server deadline countdown, and red submit button. Submission replaces the editor with plain text that slides up as the topic shrinks and moves up. The player's argument streams beneath it. `TURN_END` shows a waiting-for-opponent panel; `JUDGING` changes only its message. The result shows the winner and reason above equal-width own/opponent argument tabs, retaining the player's private prompt only in their own tab. Return links lead to the lobby. Errors and loading are inline; no reconnect or persisted match history is implemented. Prompts remain only in page memory.

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
  - `SessionContext` (app-wide, implemented in `session-provider.tsx`): current user or null, session status, `setUser()`, `refresh()` (re-checks `/auth/me`; the login form awaits it before navigating so the lobby sees the new session), `logout()`. Provider in the root layout. Replaces per-component `/auth/me` calls (`login-status.tsx` on `/health` still makes its own).
  - `MatchContext` (implemented, inside `/match/[match_id]` only): owns one match WebSocket, heartbeat echo and cleanup, a reducer over current PROTOCOL messages, `submitPrompt()`, and `resign()`. No component other than its provider touches the socket.
- One context per concern, in `app/components/providers/<name>-provider.tsx`, exporting the provider and a `use<Name>()` hook that throws outside its provider.
- Keep context values stable (`useMemo`/`useReducer`); put fast-changing streaming text in the reducer, not in many `useState`s.
- No external state libraries.

## Checks

Before finishing: `pnpm lint` and `pnpm build` pass, and the change was used in a browser (see [TESTING.md](../TESTING.md)).
