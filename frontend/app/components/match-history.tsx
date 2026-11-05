"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { eloChange, formatEloChange, modelLabel, opponentName, OUTCOME_COLOR, OUTCOME_LABEL } from "../lib/matches";
import { parseMatchPage, type MatchSummary } from "../lib/protocol";
import Icon from "./line-icon";
import { useSession } from "./providers/session-provider";

const PAGE_SIZE = 20;
const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";
const panel = "rounded-3xl border border-white/[0.07] bg-[#202124]";
const secondary = `rounded-full border border-white/20 px-5 py-2 text-sm text-white transition-colors not-aria-disabled:hover:bg-white/10 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 ${focus}`;

function MatchRow({ match }: { match: MatchSummary }) {
  const change = eloChange(match);
  const details = [`vs ${opponentName(match)}`, modelLabel(match), new Date(match.ended_at).toLocaleString(), ...(match.status === "forfeited" ? ["Forfeit"] : []), ...(match.challenge_day ? ["Daily challenge"] : [])];
  return <li>
    <Link href={`/matches/${encodeURIComponent(match.id)}`} className={`flex items-center gap-4 rounded-2xl border border-white/[0.07] p-4 transition-colors hover:border-white/20 ${focus}`}>
      <span className={`w-14 shrink-0 rounded-full border py-1 text-center text-xs font-bold ${OUTCOME_COLOR[match.outcome]}`}>{OUTCOME_LABEL[match.outcome]}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">{match.topic ?? "Topic removed"}</span>
        <span className="mt-0.5 block truncate text-xs text-zinc-400">{details.join(" · ")}</span>
      </span>
      {change !== null && <span className="shrink-0 text-xs font-semibold tabular-nums text-zinc-300">{formatEloChange(change)}</span>}
      <Icon name="arrow" className="h-4 w-4 shrink-0 text-zinc-500" />
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
  return <section aria-labelledby="history-title" className={`${panel} p-6`}>
    <h2 id="history-title" className="sr-only">Your debates</h2>
    {matches.length > 0 && <ul className="grid gap-2">{matches.map((match) => <MatchRow key={match.id} match={match} />)}</ul>}
    <div aria-live="polite" className={matches.length > 0 ? "mt-4 text-center" : ""}>
      {failed ? <p className="text-sm text-red-300">Couldn’t load your debates. <button type="button" onClick={() => setAttempt((value) => value + 1)} className={`underline ${focus}`}>Try again</button></p>
        : phase === "loading" ? <p className="text-sm text-zinc-500">Loading your debates…</p>
        : matches.length === 0 ? <p className="text-sm text-zinc-500">No debates yet. <Link href="/" className={`underline ${focus}`}>Find your first one</Link>.</p>
        : nextOffset !== null ? <button type="button" onClick={loadMore} className={secondary}>Load more</button>
        : null}
    </div>
  </section>;
}
