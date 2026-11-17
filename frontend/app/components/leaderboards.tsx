"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { displayName, parseLadders, parseLeaderboard, type Ladder, type LeaderboardEntry } from "../lib/protocol";
import { profileHref } from "../lib/routes";
import { savedArena } from "../lib/selected-arena";
import Avatar from "./avatar";
import Button, { buttonClass } from "./button";
import EmptyState from "./empty-state";
import ErrorState from "./error-state";
import PageHeader from "./page-header";
import { useSession } from "./providers/session-provider";
import Skeleton from "./skeleton";

const PAGE_SIZE = 20;
const MAX_PLAYERS = 50;

type Standings = {
  entries: LeaderboardEntry[];
  nextOffset: number | null;
  status: "loading" | "ready" | "error";
};

function StandingsTable({ ladder }: { ladder: Ladder }) {
  const router = useRouter();
  const meId = useSession().user?.id ?? null;
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

  const message = status === "loading" ? (entries.length ? "Loading more players…" : "")
    : status === "error" ? (entries.length ? "Couldn’t load more players." : "")
    : entries.length === 0 ? ""
    : nextOffset === null ? `Showing ${entries.length} ranked ${entries.length === 1 ? "player" : "players"}.` : "";

  if (entries.length === 0) {
    return status === "loading" ? <Skeleton label="Loading rankings…" variant="rows" count={6} />
      : status === "error" ? <ErrorState message="Couldn’t load rankings." onRetry={loadMore} />
      : <EmptyState title="No ranked players in this arena yet." action={<Link href="/" className={buttonClass("primary")}>Find a debate</Link>}>Finish a debate in this arena to earn your first rating.</EmptyState>;
  }

  const podium = entries.slice(0, 3);
  const rest = entries.slice(3);
  return (
    <div>
      <Podium entries={podium} meId={meId} />
      {rest.length > 0 && (
        <div className="panel mt-stack overflow-hidden">
          <table className="w-full table-fixed text-left text-sm">
            <caption className="sr-only">Rankings for {ladder.display_name}, from fourth place</caption>
            <thead className="eyebrow">
              <tr>
                <th scope="col" className="w-16 px-3 py-3.5 font-semibold sm:w-24 sm:px-5">Rank</th>
                <th scope="col" className="px-3 py-3.5 font-semibold">Player</th>
                <th scope="col" className="w-20 px-3 py-3.5 text-right font-semibold sm:w-32 sm:px-5">Elo</th>
              </tr>
            </thead>
            <tbody>
              {rest.map(({ rank, user, rating }) => {
                const me = user.id === meId;
                return <tr key={user.id} className={`border-t border-line transition-colors duration-(--duration-fast) ${me ? "bg-accent-wash" : "hover:bg-white/[0.025]"}`}>
                  <td className="stat px-3 py-3 text-xl text-ink-muted sm:px-5">{rank}</td>
                  <td className="px-3 py-2.5">
                    <Link href={profileHref(user.tag)} prefetch={false} className="group flex min-w-0 items-center gap-3 rounded-control focus-ring">
                      <span className="hidden sm:block"><Avatar name={displayName(user)} url={user.avatar_url} size={34} /></span>
                      <span className="min-w-0"><span className="block truncate font-semibold group-hover:underline">{displayName(user)}</span><span className="block truncate text-xs text-ink-faint">@{user.tag}</span></span>
                      {me && <span className="shrink-0 text-xs font-semibold text-accent-ink">You</span>}
                    </Link>
                  </td>
                  <td className="stat px-3 py-3 text-right text-2xl sm:px-5">{rating.elo}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      )}
      <div ref={sentinel} className="mt-4 flex min-h-8 items-center gap-3">
        <p aria-live="polite" className={`text-sm ${status === "error" ? "text-danger" : "text-ink-faint"}`}>{message}</p>
        {status === "error" && <Button size="sm" onClick={loadMore}>Try again</Button>}
        {status === "ready" && nextOffset !== null && <Button size="sm" onClick={loadMore}>Load more</Button>}
      </div>
    </div>
  );
}

const MEDAL = [
  { text: "text-gold", ring: "border-gold/70", border: "border-gold/30", lift: "lg:-mt-6 lg:pb-10" },
  { text: "text-silver", ring: "border-silver/60", border: "border-silver/20", lift: "" },
  { text: "text-bronze", ring: "border-bronze/60", border: "border-bronze/25", lift: "" },
];

// The top three, first place raised in the middle. Read in rank order; laid out 2-1-3.
function Podium({ entries, meId }: { entries: LeaderboardEntry[]; meId: string | null }) {
  return (
    <ol aria-label="Top three" className="grid grid-cols-1 items-end gap-stack pt-6 lg:grid-cols-3">
      {entries.map(({ rank, user, rating }, index) => {
        const medal = MEDAL[index];
        const me = user.id === meId;
        return <li key={user.id} className={`min-w-0 animate-rise ${index === 0 ? "lg:order-2" : index === 1 ? "lg:order-1" : "lg:order-3"}`} style={{ animationDelay: `${[0, 90, 180][index]}ms` }}>
          <Link href={profileHref(user.tag)} prefetch={false}
            className={`panel group flex flex-col items-center px-5 pb-7 pt-7 text-center transition-[transform,border-color] duration-(--duration-base) hover:-translate-y-1 focus-ring ${medal.border} ${medal.lift} ${me ? "bg-accent-wash" : ""}`}>
            <span className={`stat text-6xl ${medal.text}`}><span className="sr-only">Rank </span>{rank}</span>
            <span className="mt-4"><Avatar name={displayName(user)} url={user.avatar_url} size={index === 0 ? 76 : 64} ring={`border-2 ${medal.ring}`} /></span>
            <span className="mt-3 block max-w-full truncate text-base font-bold group-hover:underline">{displayName(user)}</span>
            <span className="block max-w-full truncate text-xs text-ink-faint">@{user.tag}{me && <span className="eyebrow ml-2 text-accent-ink">You</span>}</span>
            <span className="mt-4 flex items-baseline gap-1.5"><span className="stat text-4xl">{rating.elo}</span><span className="eyebrow">Elo</span></span>
            <span className="mt-1 text-xs text-ink-faint">{rating.wins}–{rating.losses} · {rating.games_played} {rating.games_played === 1 ? "debate" : "debates"}</span>
          </Link>
        </li>;
      })}
    </ol>
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
        if (controller.signal.aborted) return;
        const ladders = parseLadders(data);
        setCatalog(ladders);
        // Open on the arena last chosen in the lobby (a model's ladder is `ladder-<model id>`).
        const saved = `ladder-${savedArena()}`;
        setSelected((previous) => previous || (ladders.some(({ slug }) => slug === saved) ? saved : ""));
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
      <PageHeader id="leaderboards-title" eyebrow="Rankings" title="Leaderboards" description="The top 50 players on each arena’s ladder. Every model keeps its own Elo."
        actions={ladder && <label className="flex min-w-0 flex-wrap items-center gap-3 text-sm font-semibold">
          Arena
          <select value={ladder.slug} onChange={(event) => setSelected(event.target.value)} autoComplete="off"
            className="h-11 w-80 max-w-full min-w-0 rounded-control border border-line-strong bg-inset px-3 text-sm scheme-dark transition-colors duration-(--duration-fast) hover:border-ink-faint focus-ring">
            {catalog?.map((item) => (
              <option key={item.slug} value={item.slug}>{item.kind === "byom" ? "Bring your own model (BYOM)" : item.display_name}</option>
            ))}
          </select>
        </label>} />
      {ladder ? <StandingsTable key={ladder.slug} ladder={ladder} />
        : failed ? <ErrorState message="Couldn’t load arenas." onRetry={() => setAttempt((value) => value + 1)} />
        : catalog ? <EmptyState title="No arenas available." />
        : <Skeleton label="Loading arenas…" variant="block" />}
    </>
  );
}
