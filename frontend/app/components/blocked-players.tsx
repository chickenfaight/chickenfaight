"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { api, ApiError } from "../lib/api";
import { displayName, type UserPage, type UserPublic } from "../lib/protocol";
import { profileHref } from "../lib/routes";
import Avatar from "./avatar";
import { buttonClass } from "./button";
import EmptyState from "./empty-state";

const secondary = buttonClass("secondary", "sm");

function Player({ player }: { player: UserPublic }) {
  return <Link href={profileHref(player.tag)} className="flex min-w-0 items-center gap-3 rounded-control focus-ring">
    <Avatar name={displayName(player)} url={player.avatar_url} size={40} />
    <span className="min-w-0"><span className="block truncate text-sm font-bold">{displayName(player)}</span><span className="block truncate text-xs text-ink-faint">{player.tag}</span></span>
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
  const row = "flex items-center justify-between gap-4 rounded-inset border border-line bg-inset/50 p-3";

  return <section aria-labelledby="blocked-title" className="panel p-panel">
    <details>
      <summary className="cursor-pointer rounded-control text-sm font-bold focus-ring"><h2 id="blocked-title" className="inline">Blocked players{count}</h2></summary>
      <div className="mt-5">
        {blocked === null ? <p role="alert" className="text-sm text-danger">Couldn’t load the players you’ve blocked. Try again in a moment.</p>
          : blocked.items.length === 0 ? <EmptyState title="You haven’t blocked anyone." />
          : <>
              <ul className="grid gap-2">{blocked.items.map((player) => <li key={player.id} className={row}>
                <Player player={player} />
                {/* aria-disabled, not disabled: Firefox restores a stale disabled state on reload (frontend/AGENTS.md). */}
                <button type="button" aria-disabled={busy} onClick={() => void unblock(player.id)} className={secondary}>Unblock</button>
              </li>)}</ul>
              {blocked.next_offset !== null && <p className="mt-2 text-xs text-ink-faint">Showing your newest {shown}.</p>}
            </>}
        <p aria-live="polite" className="mt-2 text-xs text-danger">{error}</p>
      </div>
    </details>
  </section>;
}
