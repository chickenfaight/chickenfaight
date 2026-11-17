"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { displayName, parseUserPage, type UserPublic } from "../lib/protocol";
import { profileHref } from "../lib/routes";
import Avatar from "./avatar";
import Button from "./button";
import EmptyState from "./empty-state";
import ErrorState from "./error-state";
import Skeleton from "./skeleton";
const PAGE_SIZE = 20;

type State = {
  items: UserPublic[];
  nextOffset: number | null;
  status: "loading" | "idle" | "error";
};

// Full search results for one query, loading further pages as the list scrolls into view.
export default function SearchResults({ query }: { query: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ items: [], nextOffset: 0, status: "loading" });
  const sentinel = useRef<HTMLLIElement>(null);
  const controller = useRef<AbortController | null>(null);

  // Callers mark the state "loading" first; it starts that way for the first page.
  const fetchPage = useCallback(async (offset: number) => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    try {
      const params = new URLSearchParams({ q: query, limit: String(PAGE_SIZE), offset: String(offset) });
      const page = parseUserPage(await api(`/v1/users/search?${params}`, current.signal));
      setState((previous) => ({
        // Skip anyone already listed in case a new signup shifted the pages.
        items: [...previous.items, ...page.items.filter((user) => !previous.items.some((seen) => seen.id === user.id))],
        nextOffset: page.next_offset,
        status: "idle",
      }));
    } catch (error) {
      if (current.signal.aborted) return;
      if (error instanceof ApiError && error.status === 401) { router.replace("/login"); return; }
      setState((previous) => ({ ...previous, status: "error" }));
    }
  }, [query, router]);

  const loadPage = useCallback((offset: number) => {
    setState((previous) => ({ ...previous, status: "loading" }));
    void fetchPage(offset);
  }, [fetchPage]);

  useEffect(() => {
    async function loadFirstPage() { await fetchPage(0); }
    void loadFirstPage();
    return () => controller.current?.abort();
  }, [fetchPage]);

  const { items, nextOffset, status } = state;
  useEffect(() => {
    const target = sentinel.current;
    if (!target || status !== "idle" || nextOffset === null) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadPage(nextOffset);
    }, { rootMargin: "200px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [loadPage, nextOffset, status]);

  const message = status === "loading" ? (items.length ? "Loading more…" : "")
    : status === "error" ? (items.length ? "Couldn’t load more results." : "")
    : items.length === 0 ? ""
    : nextOffset === null ? `${items.length} ${items.length === 1 ? "player" : "players"} found.`
    : "";

  if (items.length === 0) {
    return status === "loading" ? <Skeleton label="Searching…" variant="cards" count={6} />
      : status === "error" ? <ErrorState message="Couldn’t load results." onRetry={() => loadPage(nextOffset ?? 0)} />
      : <EmptyState title={`No players match “${query}”.`}>Check the spelling, or search by their tag.</EmptyState>;
  }

  return (
    <>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-3">
        {items.map((user, index) => (
          <li key={user.id} className="animate-rise" style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}>
            <Link href={profileHref(user.tag)} className="panel group flex min-w-0 items-center gap-4 p-4 transition-[border-color,background-color] duration-(--duration-fast) hover:border-line-strong hover:bg-surface-raised focus-ring">
              <Avatar name={displayName(user)} url={user.avatar_url} size={44} />
              <span className="min-w-0"><span className="block truncate text-sm font-bold group-hover:underline">{displayName(user)}</span><span className="block truncate text-xs text-ink-faint">@{user.tag}</span></span>
            </Link>
          </li>
        ))}
        <li ref={sentinel} aria-hidden="true" className="col-span-full h-px" />
      </ul>
      <div className="mt-6 flex items-center gap-4">
        <p aria-live="polite" className={`text-sm ${status === "error" ? "text-danger" : "text-ink-faint"}`}>{message}</p>
        {status === "error" && <Button size="sm" onClick={() => loadPage(nextOffset ?? 0)}>Try again</Button>}
      </div>
    </>
  );
}
