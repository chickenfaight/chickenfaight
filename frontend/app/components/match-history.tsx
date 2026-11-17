"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { eloChange, eloChangeColor, modelLabel, opponentName, OUTCOME_COLOR, OUTCOME_LABEL, SIDE_LABEL, SIDE_TEXT, signed } from "../lib/matches";
import { parseMatchPage, type MatchSummary } from "../lib/protocol";
import Button, { buttonClass } from "./button";
import CountUp from "./count-up";
import EmptyState from "./empty-state";
import ErrorState from "./error-state";
import Icon from "./line-icon";
import Skeleton from "./skeleton";
import { useSession } from "./providers/session-provider";

const PAGE_SIZE = 20;

function MatchRow({ match, index }: { match: MatchSummary; index: number }) {
  const change = eloChange(match);
  const you = match.participants.find((participant) => participant.side === match.you);
  const endedAt = new Date(match.ended_at);
  return <li className="animate-rise" style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}>
    <Link href={`/matches/${encodeURIComponent(match.id)}`} className="group flex flex-wrap items-center gap-x-4 gap-y-3 rounded-inset border border-line bg-inset/50 p-4 transition-[border-color,background-color,transform] duration-(--duration-fast) hover:border-line-strong hover:bg-inset active:scale-[0.995] focus-ring">
      <span className={`stat w-14 shrink-0 rounded-control border py-1.5 text-center text-base uppercase ${OUTCOME_COLOR[match.outcome]}`}>{OUTCOME_LABEL[match.outcome]}</span>
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm font-bold leading-snug [overflow-wrap:anywhere]">{match.topic ?? "Topic removed"}</span>
        <span className="mt-1 block truncate text-xs text-ink-muted">vs {opponentName(match)}</span>
        <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-faint">
          <span className={`font-semibold ${SIDE_TEXT[match.you]}`}>{SIDE_LABEL[match.you]}</span>
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{modelLabel(match)}</span>
          {match.status === "forfeited" && <span>Forfeit</span>}
          {match.challenge_day && <span>Daily challenge</span>}
        </span>
      </span>
      {change !== null && you?.elo_before != null && you.elo_after != null && <span className="flex shrink-0 flex-col items-end">
        <CountUp from={0} to={change} format={(value) => signed(value)} className={`stat text-2xl ${eloChangeColor(change)}`} />
        <span className="stat mt-0.5 text-sm text-ink-faint">{you.elo_after} Elo</span>
      </span>}
      <span className="flex w-full items-center justify-between gap-2 border-t border-line pt-2 text-xs text-ink-faint sm:w-auto sm:flex-col sm:items-end sm:border-0 sm:pt-0">
        <time dateTime={match.ended_at} title={endedAt.toLocaleString()}>{endedAt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</time>
        <span className="inline-flex items-center gap-1.5 text-ink-muted group-hover:text-ink">View debate<Icon name="arrow" className="h-3.5 w-3.5 shrink-0 transition-transform duration-(--duration-fast) group-hover:translate-x-0.5" /></span>
      </span>
    </Link>
  </li>;
}

// The signed-in player's finished debates, newest first.
export default function MatchHistory() {
  const { user, status } = useSession();
  const userId = user?.id ?? null;
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const moreController = useRef<AbortController | null>(null);

  const loadPage = useCallback(async (id: string, offset: number, signal: AbortSignal) => {
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      const page = parseMatchPage(await api(`/v1/users/${encodeURIComponent(id)}/matches?${params}`, signal));
      if (signal.aborted) return;
      // A debate finishing while paging shifts the offsets, so drop any repeat.
      setMatches((previous) => {
        const seen = new Set(previous.map((match) => match.id));
        return [...previous, ...page.items.filter((match) => !seen.has(match.id))];
      });
      setNextOffset(page.next_offset);
      setPhase("ready");
    } catch {
      if (!signal.aborted) setPhase("error");
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    async function load(id: string) {
      setMatches([]);
      setPhase("loading");
      await loadPage(id, 0, controller.signal);
    }
    void load(userId);
    return () => { controller.abort(); moreController.current?.abort(); };
  }, [userId, attempt, loadPage]);

  function loadMore() {
    if (!userId || nextOffset === null || phase === "loading") return;
    const controller = new AbortController();
    moreController.current = controller;
    setPhase("loading");
    void loadPage(userId, nextOffset, controller.signal);
  }

  const failed = phase === "error" || status === "error";
  return <section aria-labelledby="history-title" className="panel p-panel">
    <h2 id="history-title" className="sr-only">Your debates</h2>
    {matches.length > 0 && <>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 text-xs text-ink-faint"><p>Newest first</p><p>{matches.length} {matches.length === 1 ? "debate" : "debates"}{nextOffset !== null ? " loaded" : ""}</p></div>
      <ul className="grid gap-2">{matches.map((match, index) => <MatchRow key={match.id} match={match} index={index} />)}</ul>
    </>}
    <div aria-live="polite" className={matches.length > 0 ? "mt-4 flex justify-center" : ""}>
      {failed ? (matches.length > 0
          ? <ErrorState compact message="Couldn’t load your debates." onRetry={() => setAttempt((value) => value + 1)} />
          : <ErrorState message="Couldn’t load your debates." onRetry={() => setAttempt((value) => value + 1)} />)
        : phase === "loading" ? (matches.length > 0 ? <p className="text-sm text-ink-faint">Loading more debates…</p> : <Skeleton label="Loading your debates…" variant="rows" count={5} />)
        : matches.length === 0 ? <EmptyState title="No debates yet." action={<Link href="/" className={buttonClass("primary")}>Find your first one</Link>}>Your finished debates, wins and losses, and Elo changes show up here.</EmptyState>
        : nextOffset !== null ? <Button aria-disabled={phase !== "ready"} onClick={loadMore}>Load more</Button>
        : null}
    </div>
  </section>;
}
