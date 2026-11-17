"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { parseArenaStats, type ArenaStats } from "../lib/protocol";
import ErrorState from "./error-state";
import Skeleton from "./skeleton";

export default function ArenaStatsCard() {
  const [stats, setStats] = useState<ArenaStats | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api("/v1/users/me/arena-stats", controller.signal)
      .then(data => { if (!controller.signal.aborted) setStats(parseArenaStats(data)); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [attempt]);

  return <section aria-labelledby="stats-title" className="border-t border-line pt-5">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <h2 id="stats-title" className="text-sm font-bold">Your recent results</h2>
      <Link href="/matches" className="rounded-control text-sm font-semibold text-accent-ink underline underline-offset-4 focus-ring">View debate history</Link>
    </div>
    <div className="mt-4" aria-live="polite">
      {error ? <ErrorState compact message="Couldn’t load your results." onRetry={() => { setError(false); setAttempt(value => value + 1); }} />
        : !stats ? <Skeleton label="Loading your results…" variant="lines" count={1} />
        : <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <p className="text-sm text-ink-muted"><span className="stat mr-1.5 text-2xl text-ink">{stats.points.toLocaleString()}</span>points</p>
          {stats.recent_form.length ? <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-ink-muted">Newest first · all arenas</span>
            <div className="flex gap-1.5" aria-label="Recent results, newest first">{stats.recent_form.map((result, i) => <span key={i} aria-label={result === "W" ? "Win" : "Loss"} className={`stat flex h-8 w-8 items-center justify-center rounded-control border text-base ${result === "W" ? "border-win/35 bg-win/10 text-win" : "border-line bg-surface text-ink-muted"}`}>{result}</span>)}</div>
          </div> : <p className="text-sm text-ink-muted">No results yet. Find your first debate above.</p>}
        </div>}
    </div>
  </section>;
}
