"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { parseUserPage, type UserPublic } from "../lib/protocol";
import { profileHref } from "../lib/routes";
import Avatar from "./avatar";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";
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

  const message = status === "loading" ? (items.length ? "Loading more…" : "Searching…")
    : status === "error" ? "Couldn’t load results."
    : items.length === 0 ? `No players match “${query}”.`
    : nextOffset === null ? `${items.length} ${items.length === 1 ? "player" : "players"} found.`
    : "";

  return (
    <>
      {items.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 xl:grid-cols-3">
          {items.map((user) => (
            <li key={user.id}>
              <Link href={profileHref(user.username)} className={`flex items-center gap-4 rounded-3xl border border-white/[0.07] bg-[#202124] p-4 hover:border-white/20 ${focus}`}>
                <Avatar username={user.username} url={user.avatar_url} size={44} />
                <span className="truncate text-sm font-bold">{user.username}</span>
              </Link>
            </li>
          ))}
          <li ref={sentinel} aria-hidden="true" className="col-span-full h-px" />
        </ul>
      )}
      <div className="mt-6 flex items-center gap-4">
        <p aria-live="polite" className="text-sm text-zinc-500">{message}</p>
        {status === "error" && (
          <button onClick={() => loadPage(nextOffset ?? 0)} className={`rounded-full border border-white/20 px-4 py-1.5 text-xs text-white hover:bg-white/10 ${focus}`}>Try again</button>
        )}
      </div>
    </>
  );
}
