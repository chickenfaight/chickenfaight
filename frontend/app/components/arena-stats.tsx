"use client";

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

  return <section aria-labelledby="stats-title" className="panel flex flex-1 flex-col justify-center p-panel">
    <div className="mb-5 flex items-center justify-between"><h2 id="stats-title" className="text-sm font-bold">Your arena stats</h2><span className="eyebrow">All arenas</span></div>
    {error ? <ErrorState compact message="Couldn’t load your stats." onRetry={() => { setError(false); setAttempt(value => value + 1); }} />
      : !stats ? <Skeleton label="Loading your stats…" variant="lines" count={4} />
      : <>
        <dl className="grid grid-cols-2 gap-y-5">
          {([
            ["Points", stats.points.toLocaleString()],
            ["Win rate", stats.win_rate === null ? "—" : `${Math.round(stats.win_rate)}%`],
            ["Debates played", stats.debates_played.toLocaleString()],
            ["Wins", stats.wins.toLocaleString()],
          ] as const).map(([label, value]) => <div key={label}><dt className="text-xs text-ink-muted">{label}</dt><dd className="stat mt-1.5 text-4xl">{value}</dd></div>)}
        </dl>
        <div className="mt-5 flex items-center justify-between border-t border-line pt-4"><span className="text-xs text-ink-muted">Recent form</span>
          {stats.recent_form.length ? <div className="flex gap-1.5" aria-label="Recent results, newest first">{stats.recent_form.map((result, i) => <span key={i} aria-label={result === "W" ? "Win" : "Loss"} className={`stat flex h-7 w-7 items-center justify-center rounded-control border text-sm ${result === "W" ? "border-win/35 bg-win/10 text-win" : "border-line bg-white/[0.03] text-ink-faint"}`}>{result}</span>)}</div>
            : <span className="text-xs text-ink-faint">No results yet</span>}
        </div>
        <p className="mt-3 text-xs text-ink-faint">Forfeits count. Voided debates don’t.</p>
      </>}
  </section>;
}
