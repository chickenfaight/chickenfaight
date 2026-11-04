"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { displayName, parseLadders, parseLeaderboard, type Ladder, type LeaderboardEntry } from "../lib/protocol";
import { profileHref } from "../lib/routes";
import Avatar from "./avatar";

const PAGE_SIZE = 20;
const MAX_PLAYERS = 50;
const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";
const buttonStyle = `rounded-full border border-white/20 px-4 py-1.5 text-xs text-white hover:bg-white/10 ${focus}`;

type Standings = {
  entries: LeaderboardEntry[];
  nextOffset: number | null;
  status: "loading" | "ready" | "error";
};

function StandingsTable({ ladder }: { ladder: Ladder }) {
  const router = useRouter();
  const [state, setState] = useState<Standings>({ entries: [], nextOffset: 0, status: "loading" });
  const pending = useRef<AbortController | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  const fetchPage = useCallback((offset: number) => {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    const limit = Math.min(PAGE_SIZE, MAX_PLAYERS - offset);
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    api(`/v1/ladders/${encodeURIComponent(ladder.slug)}/leaderboard?${params}`, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        const page = parseLeaderboard(data);
        setState((previous) => ({
          // A rating can change between requests and move a player onto the next page.
          entries: [...previous.entries, ...page.filter(({ user }) => !previous.entries.some((entry) => entry.user.id === user.id))],
          nextOffset: page.length === limit && offset + limit < MAX_PLAYERS ? offset + limit : null,
          status: "ready",
        }));
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) router.replace("/login");
        else setState((previous) => ({ ...previous, status: "error" }));
      })
      .finally(() => {
        if (pending.current === controller) pending.current = null;
      });
  }, [ladder.slug, router]);

  useEffect(() => {
    fetchPage(0);
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [fetchPage]);

  const { entries, nextOffset, status } = state;
  const loadMore = useCallback(() => {
    if (nextOffset === null || pending.current) return;
    setState((previous) => ({ ...previous, status: "loading" }));
    fetchPage(nextOffset);
  }, [fetchPage, nextOffset]);

  useEffect(() => {
    const target = sentinel.current;
    if (!target || status !== "ready" || nextOffset === null || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver((intersections) => {
      if (intersections.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        loadMore();
      }
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [loadMore, nextOffset, status]);

  const message = status === "loading" ? (entries.length ? "Loading more players…" : "Loading rankings…")
    : status === "error" ? (entries.length ? "Couldn’t load more players." : "Couldn’t load rankings.")
    : entries.length === 0 ? "No ranked players in this arena yet."
    : nextOffset === null ? `Showing ${entries.length} ranked ${entries.length === 1 ? "player" : "players"}.` : "";

  return (
    <div>
      {entries.length > 0 && (
        <div className="rounded-xl border border-white/[0.07] bg-[#202124]">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Rankings for {ladder.display_name}</caption>
            <thead className="text-xs text-zinc-400">
              <tr>
                <th scope="col" className="w-24 px-5 py-3 font-semibold">Rank</th>
                <th scope="col" className="px-3 py-3 font-semibold">Player</th>
                <th scope="col" className="w-32 px-5 py-3 text-right font-semibold">Elo</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(({ rank, user, rating }) => (
                <tr key={user.id} className="border-t border-white/[0.07]">
                  <td className="px-5 py-2 text-zinc-300 tabular-nums">{rank}</td>
                  <td className="px-3 py-2">
                    <Link href={profileHref(user.tag)} prefetch={false} className={`inline-flex items-center gap-3 rounded-xl hover:underline ${focus}`}>
                      <Avatar name={displayName(user)} url={user.avatar_url} size={32} />
                      <span><span className="block font-semibold">{displayName(user)}</span><span className="block text-xs text-zinc-400">@{user.tag}</span></span>
                    </Link>
                  </td>
                  <td className="px-5 py-2 text-right font-semibold tabular-nums">{rating.elo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div ref={sentinel} className="mt-4 flex min-h-8 items-center gap-3">
        <p aria-live="polite" className="text-sm text-zinc-400">{message}</p>
        {status === "error" && <button onClick={loadMore} className={buttonStyle}>Try again</button>}
        {status === "ready" && nextOffset !== null && <button onClick={loadMore} className={buttonStyle}>Load more</button>}
      </div>
    </div>
  );
}

export default function Leaderboards() {
  const router = useRouter();
  const [catalog, setCatalog] = useState<Ladder[] | null>(null);
  const [selected, setSelected] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [failedAttempt, setFailedAttempt] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api("/v1/ladders", controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setCatalog(parseLadders(data));
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) router.replace("/login");
        else setFailedAttempt(attempt);
      });
    return () => controller.abort();
  }, [attempt, router]);

  const ladder = catalog?.find(({ slug }) => slug === selected) ?? catalog?.[0];
  const failed = failedAttempt === attempt;

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 id="leaderboards-title" className="text-2xl font-bold tracking-tight">Leaderboards</h1>
        {ladder && <label className="flex items-center gap-3 text-sm font-semibold">
          Arena
          <select value={ladder.slug} onChange={(event) => setSelected(event.target.value)} autoComplete="off"
            className={`w-80 max-w-full rounded-xl border border-white/15 bg-[#202124] px-3 py-2.5 text-sm scheme-dark ${focus}`}>
            {catalog?.map((item) => (
              <option key={item.slug} value={item.slug}>{item.kind === "byom" ? "Bring your own model (BYOM)" : item.display_name}</option>
            ))}
          </select>
        </label>}
      </div>
      {ladder ? <StandingsTable key={ladder.slug} ladder={ladder} /> : (
        <div className="flex items-center gap-3">
          <p aria-live="polite" className="text-sm text-zinc-400">
            {failed ? "Couldn’t load arenas." : catalog ? "No arenas available." : "Loading arenas…"}
          </p>
          {failed && <button onClick={() => setAttempt((value) => value + 1)} className={buttonStyle}>Try again</button>}
        </div>
      )}
    </>
  );
}
