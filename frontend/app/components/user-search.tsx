"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api, ApiError } from "../lib/api";
import { displayName, parseUserPage, type UserPublic } from "../lib/protocol";
import { profileHref, searchHref } from "../lib/routes";
import Avatar from "./avatar";
import Icon from "./line-icon";
const SUGGESTION_LIMIT = 5;
const DEBOUNCE_MS = 200;

type Suggestions =
  | { status: "loading" }
  | { status: "done"; items: UserPublic[] }
  | { status: "error"; detail: string };

// Player search with live completion. Enter opens the highlighted player, or the full results page.
export default function UserSearch({ initialQuery = "" }: { initialQuery?: string }) {
  const router = useRouter();
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [fieldOpen, setFieldOpen] = useState(false);
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
        if (!controller.signal.aborted) setSuggestions({ status: "done", items: page.items });
      } catch (error) {
        if (controller.signal.aborted) return;
        setSuggestions({ status: "error", detail: error instanceof ApiError && error.status === 401 ? "Sign in to search players." : "Search is unavailable." });
      }
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [expanded, trimmed]);

  const items = suggestions.status === "done" ? suggestions.items : [];

  function close() {
    setOpen(false);
    setActive(-1);
    setFieldOpen(false);
  }

  function dismiss() {
    trigger.current?.focus();
    close();
  }

  function go(href: string) {
    dismiss();
    router.push(href);
  }

  function keepInputFocus(event: React.MouseEvent) {
    // WebKit may blur the input without a related target before a search control's click.
    event.preventDefault();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (!items.length) return;
      // Cycle through the options and back to the input itself (-1).
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (current + 1 + step + items.length + 1) % (items.length + 1) - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      dismiss();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (active >= 0 && active < items.length) go(profileHref(items[active].tag));
      else if (trimmed) go(searchHref(trimmed));
    }
  }

  return (
    <div className={`h-11 lg:relative lg:transition-[width] lg:duration-(--duration-base) lg:ease-out ${fieldOpen ? "lg:w-52 min-[1101px]:w-72" : "lg:w-11"}`} role="search" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) close();
    }} onKeyDown={(event) => {
      // Escape also works on the close button and the results link.
      if (fieldOpen && !event.defaultPrevented && event.key === "Escape") {
        event.preventDefault();
        dismiss();
      }
    }}>
      <button
        ref={trigger}
        type="button"
        aria-label="Search players"
        aria-expanded={fieldOpen}
        aria-controls={`${listId}-field`}
        onMouseDown={fieldOpen ? keepInputFocus : undefined}
        onClick={() => {
          if (fieldOpen) { dismiss(); return; }
          // Focus in the tapping event so phones can open their software keyboard.
          flushSync(() => setFieldOpen(true));
          input.current?.focus();
        }}
        className={`flex h-11 items-center justify-center rounded-control px-2 text-sm font-semibold text-ink-muted transition-colors duration-(--duration-fast) hover:text-ink focus-ring lg:absolute lg:left-0 lg:top-0 lg:z-10 lg:w-11 lg:px-0 ${fieldOpen ? "" : "hover:bg-surface-raised"}`}
      >
        <Icon name="search" className="hidden h-5 w-5 lg:block" />
        <span className="lg:hidden">Search</span>
      </button>
      <div id={`${listId}-field`} className={`absolute inset-x-gutter top-full mt-2 transition-opacity duration-(--duration-fast) max-[359px]:inset-x-3 lg:static lg:mt-0 ${fieldOpen ? "visible opacity-100" : "invisible pointer-events-none opacity-0"}`}>
        <label htmlFor={`${listId}-input`} className="sr-only">Search players by username or tag</label>
        <input
          ref={input}
          id={`${listId}-input`}
          type="search"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          enterKeyHint="search"
          spellCheck={false}
          maxLength={64}
          placeholder="Search players"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(-1); setSuggestions({ status: "loading" }); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="h-11 w-full min-w-0 rounded-control border border-line-strong bg-inset pl-4 pr-11 text-base text-ink transition-colors duration-(--duration-fast) placeholder:text-ink-faint hover:border-ink-faint focus-ring [&::-webkit-search-cancel-button]:appearance-none lg:pl-11 lg:text-sm"
        />
        <button type="button" onMouseDown={keepInputFocus} onClick={dismiss} aria-label="Close player search" className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-control text-ink-muted hover:text-ink focus-ring">
          <Icon name="cross" />
        </button>
        {expanded && (
          <div className="absolute right-0 top-full z-30 w-full pt-2">
            <div className="max-h-[45dvh] overflow-y-auto overscroll-contain rounded-panel border border-line-strong bg-surface p-2 text-sm shadow-overlay animate-pop">
              <ul id={listId} role="listbox" aria-label="Matching players">
                {items.map((user, index) => (
                  <li
                    key={user.id}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={index === active}
                    onMouseDown={keepInputFocus}
                    onClick={() => go(profileHref(user.tag))}
                    onMouseEnter={() => setActive(index)}
                    className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-3 py-2 transition-colors duration-(--duration-instant) ${index === active ? "bg-white/[0.07]" : ""}`}
                  >
                    <Avatar name={displayName(user)} url={user.avatar_url} size={28} />
                    <span className="min-w-0 truncate"><span className="font-semibold">{displayName(user)}</span> <span className="text-xs text-ink-muted">@{user.tag}</span></span>
                  </li>
                ))}
              </ul>
              <p aria-live="polite" className="px-3 text-sm text-ink-muted empty:hidden">
                {suggestions.status === "loading" ? "Searching…"
                  : suggestions.status === "error" ? suggestions.detail
                  : items.length === 0 ? `No players match “${trimmed}”.` : `${items.length} suggestions`}
              </p>
              <Link href={searchHref(trimmed)} onMouseDown={keepInputFocus} onNavigate={dismiss} className="flex min-h-11 items-center rounded-control px-3 font-semibold text-accent-ink hover:bg-white/[0.05] focus-ring">See all results</Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
