"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { api, ApiError } from "../lib/api";
import { displayName, type UserPage, type UserPublic } from "../lib/protocol";
import { profileHref } from "../lib/routes";
import Avatar from "./avatar";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";
const secondary = `h-9 shrink-0 rounded-xl border border-white/15 px-4 text-xs font-bold transition-colors aria-disabled:cursor-not-allowed aria-disabled:opacity-50 not-aria-disabled:hover:bg-white/5 ${focus}`;

function Player({ player }: { player: UserPublic }) {
  return <Link href={profileHref(player.tag)} className={`flex min-w-0 items-center gap-3 ${focus}`}>
    <Avatar name={displayName(player)} url={player.avatar_url} size={40} />
    <span className="min-w-0"><span className="block truncate text-sm font-bold">{displayName(player)}</span><span className="block truncate text-xs text-zinc-500">{player.tag}</span></span>
  </Link>;
}

// The signed-in player's blocks, collapsed by default. Unblocking refreshes the page, so the
// server's list stays the only source of truth.
export default function BlockedPlayers({ blocked, shown }: { blocked: UserPage | null; shown: number }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const busy = running || refreshing;

  async function unblock(id: string) {
    if (busy) return;
    const current = new AbortController();
    controller.current = current;
    setRunning(true);
    setError("");
    try {
      await api(`/v1/block/${encodeURIComponent(id)}`, current.signal, "DELETE");
      startRefresh(() => router.refresh());
    } catch (err) {
      if (current.signal.aborted) return;
      if (err instanceof ApiError && err.status === 401) { router.replace("/login"); return; }
      setError(err instanceof ApiError && err.status === 429 ? "Too many changes. Wait a moment and try again." : "Couldn’t unblock that player. Try again.");
    } finally {
      if (!current.signal.aborted) setRunning(false);
    }
  }

  const count = blocked === null ? "" : ` (${blocked.next_offset === null ? blocked.items.length : `${shown}+`})`;
  const row = "flex items-center justify-between gap-4 rounded-2xl border border-white/[0.07] p-3";

  return <section aria-labelledby="blocked-title" className="rounded-3xl border border-white/[0.07] bg-[#202124] p-6">
    <details>
      <summary className={`cursor-pointer text-sm font-bold ${focus}`}><h2 id="blocked-title" className="inline">Blocked players{count}</h2></summary>
      <div className="mt-5">
        {blocked === null ? <p className="text-sm text-zinc-500">Couldn’t load the players you’ve blocked. Try again in a moment.</p>
          : blocked.items.length === 0 ? <p className="text-sm text-zinc-500">You haven’t blocked anyone.</p>
          : <>
              <ul className="grid gap-2">{blocked.items.map((player) => <li key={player.id} className={row}>
                <Player player={player} />
                {/* aria-disabled, not disabled: Firefox restores a stale disabled state on reload (frontend/AGENTS.md). */}
                <button type="button" aria-disabled={busy} onClick={() => void unblock(player.id)} className={secondary}>Unblock</button>
              </li>)}</ul>
              {blocked.next_offset !== null && <p className="mt-2 text-xs text-zinc-500">Showing your newest {shown}.</p>}
            </>}
        <p aria-live="polite" className="mt-2 text-xs text-[#f37981]">{error}</p>
      </div>
    </details>
  </section>;
}
