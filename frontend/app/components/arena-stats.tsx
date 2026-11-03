"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { parseArenaStats, type ArenaStats } from "../lib/protocol";

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

  return <section aria-labelledby="stats-title" className="flex flex-1 flex-col justify-center rounded-3xl border border-white/[0.07] bg-[#202124] p-5">
    <div className="mb-5 flex items-center justify-between"><h2 id="stats-title" className="text-sm font-bold">Your arena stats</h2><span className="text-[9px] uppercase tracking-wider text-zinc-500">All arenas</span></div>
    {error ? <div role="alert" className="text-xs text-zinc-400">Couldn’t load your stats. <button onClick={() => { setError(false); setAttempt(value => value + 1); }} className="ml-1 text-[#ff7882] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">Try again</button></div>
      : !stats ? <p role="status" className="text-xs text-zinc-400">Loading your stats…</p>
      : <>
        <div className="grid grid-cols-2 gap-y-5">
          {([
            ["Points", stats.points.toLocaleString()],
            ["Win rate", stats.win_rate === null ? "—" : `${Math.round(stats.win_rate)}%`],
            ["Debates played", stats.debates_played.toLocaleString()],
            ["Wins", stats.wins.toLocaleString()],
          ] as const).map(([label, value]) => <div key={label}><p className="text-[10px] text-zinc-400">{label}</p><p className="mt-1 text-2xl font-bold tracking-tight">{value}</p></div>)}
        </div>
        <div className="mt-5 flex items-center justify-between border-t border-white/[0.07] pt-4"><span className="text-[10px] text-zinc-400">Recent form</span>
          {stats.recent_form.length ? <div className="flex gap-1.5" aria-label="Recent results, newest first">{stats.recent_form.map((result, i) => <span key={i} aria-label={result === "W" ? "Win" : "Loss"} className={`flex h-6 w-6 items-center justify-center rounded-md text-[9px] font-bold ${result === "W" ? "bg-emerald-400/10 text-emerald-400" : "bg-white/5 text-zinc-500"}`}>{result}</span>)}</div>
            : <span className="text-[10px] text-zinc-500">No results yet</span>}
        </div>
        <p className="mt-3 text-[9px] text-zinc-500">Forfeits count. Voided debates don’t.</p>
      </>}
  </section>;
}
