<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

Before any frontend change, read [FRONTEND.md](FRONTEND.md) and the root [AGENTS.md](../AGENTS.md).

Frontend pitfalls already hit in this repo:
- Server Components that call the backend forward the browser's raw `Cookie` header with `forwardedCookie()` (`app/lib/server-session.ts`), never `cookies().toString()`, which URL-encodes the signed session cookie and breaks it.
- Never trust a session on the client alone: pages check it with the backend (`serverSession()` or `/auth/me`). `/` and `/login` redirect on the server; `SessionProvider` redirects to `/login` when the session ends.
- Firefox restores a form control's old `disabled` state on reload, before React loads, which breaks hydration. For buttons whose disabled state changes after load, use `aria-disabled` and guard the click; for `<select>` and `<input>`, add `autoComplete="off"` (React's types don't allow it on buttons).
