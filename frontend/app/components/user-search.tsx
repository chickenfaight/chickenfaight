"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { api, ApiError } from "../lib/api";
import { displayName, parseUserPage, type UserPublic } from "../lib/protocol";
import { profileHref, searchHref } from "../lib/routes";
import Avatar from "./avatar";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";
const SUGGESTION_LIMIT = 5;
const DEBOUNCE_MS = 200;

type Suggestions =
  | { status: "loading" }
  | { status: "done"; items: UserPublic[] }
  | { status: "error"; detail: string };

// Tag search with live completion. Enter opens the highlighted player, or the full results page.
export default function UserSearch({ initialQuery = "" }: { initialQuery?: string }) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [suggestions, setSuggestions] = useState<Suggestions>({ status: "loading" });
  const trimmed = query.trim();

  const expanded = open && trimmed !== "";

  // Only fetch while the list is showing, so a prefilled bar (on /search) stays idle until focused.
  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: trimmed, limit: String(SUGGESTION_LIMIT) });
        const page = parseUserPage(await api(`/v1/users/search?${params}`, controller.signal));
        setSuggestions({ status: "done", items: page.items });
      } catch (error) {
        if (controller.signal.aborted) return;
        setSuggestions({ status: "error", detail: error instanceof ApiError && error.status === 401 ? "Sign in to search players." : "Search is unavailable." });
      }
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [expanded, trimmed]);

  const items = suggestions.status === "done" ? suggestions.items : [];

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (!items.length) return;
      // Cycle through the options and back to the input itself (-1).
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (current + 1 + step + items.length + 1) % (items.length + 1) - 1);
    } else if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (active >= 0 && active < items.length) go(profileHref(items[active].tag));
      else if (trimmed) go(searchHref(trimmed));
    }
  }

  return (
    <div className="relative w-72" role="search" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <label htmlFor={`${listId}-input`} className="sr-only">Search players by tag</label>
      <input
        id={`${listId}-input`}
        type="search"
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        maxLength={64}
        placeholder="Search players"
        value={query}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(-1); setSuggestions({ status: "loading" }); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className={`w-full rounded-xl border border-white/10 bg-[#202124] px-4 py-2.5 text-sm text-[#f5f3ef] placeholder:text-zinc-500 hover:border-white/20 ${focus}`}
      />
      {expanded && (
        <div className="absolute right-0 top-full z-30 w-full pt-2">
          <div className="rounded-3xl border border-white/[0.07] bg-[#202124] p-2 text-sm">
            <ul id={listId} role="listbox" aria-label="Matching players">
              {items.map((user, index) => (
                <li
                  key={user.id}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => go(profileHref(user.tag))}
                  onMouseEnter={() => setActive(index)}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 ${index === active ? "bg-white/5" : ""}`}
                >
                  <Avatar name={displayName(user)} url={user.avatar_url} size={28} />
                  <span className="min-w-0 truncate"><span className="font-semibold">{displayName(user)}</span> <span className="text-xs text-zinc-500">{user.tag}</span></span>
                </li>
              ))}
            </ul>
            <p aria-live="polite" className="px-3 py-2 text-xs text-zinc-500">
              {suggestions.status === "loading" ? "Searching…"
                : suggestions.status === "error" ? suggestions.detail
                : items.length === 0 ? `No players match “${trimmed}”.`
                : "Press Enter for all results."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
