"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { api, ApiError } from "../lib/api";
import { displayName, type UserPage, type UserPublic } from "../lib/protocol";
import { profileHref } from "../lib/routes";
import Avatar from "./avatar";
import { useFriendRequests } from "./providers/friend-requests-provider";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";
const button = `h-9 rounded-xl px-4 text-xs font-bold transition-colors aria-disabled:cursor-not-allowed aria-disabled:opacity-50 ${focus}`;
const primary = `${button} bg-[#e53848] text-white not-aria-disabled:hover:bg-[#c92d3c]`;
const secondary = `${button} border border-white/15 not-aria-disabled:hover:bg-white/5`;

function Player({ player }: { player: UserPublic }) {
  return <Link href={profileHref(player.tag)} className={`flex min-w-0 items-center gap-3 ${focus}`}>
    <Avatar name={displayName(player)} url={player.avatar_url} size={40} />
    <span className="min-w-0"><span className="block truncate text-sm font-bold">{displayName(player)}</span><span className="block truncate text-xs text-zinc-500">{player.tag}</span></span>
  </Link>;
}

// The signed-in player's pending requests. Each answer refreshes the page, which also updates the
// Friends panel, so the server's lists stay the only source of truth.
export default function FriendRequests({ incoming, outgoing, shown }: { incoming: UserPage | null; outgoing: UserPage | null; shown: number }) {
  const router = useRouter();
  const { refresh: recount } = useFriendRequests();
  const [refreshing, startRefresh] = useTransition();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const blocked = running || refreshing;

  async function answer(path: string, method: "POST" | "DELETE") {
    if (blocked) return;
    const current = new AbortController();
    controller.current = current;
    setRunning(true);
    setError("");
    try {
      await api(path, current.signal, method);
      startRefresh(() => router.refresh());
      void recount();
    } catch (err) {
      if (current.signal.aborted) return;
      if (err instanceof ApiError && err.status === 401) { router.replace("/login"); return; }
      if (err instanceof ApiError && err.code === "NOT_FOUND") {
        setError("That request is no longer open.");
        startRefresh(() => router.refresh());
        void recount();
      } else {
        setError(err instanceof ApiError && err.status === 429 ? "Too many changes. Wait a moment and try again." : "Couldn’t update that request. Try again.");
      }
    } finally {
      if (!current.signal.aborted) setRunning(false);
    }
  }

  const request = (id: string) => `/v1/friends/requests/${encodeURIComponent(id)}`;
  const empty = incoming?.items.length === 0 && outgoing?.items.length === 0;
  const row = "flex items-center justify-between gap-4 rounded-2xl border border-white/[0.07] p-3";
  const label = "mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-400";

  return <section aria-labelledby="friend-requests-title" className="col-span-2 rounded-3xl border border-white/[0.07] bg-[#202124] p-6">
    <h2 id="friend-requests-title" className="mb-5 text-sm font-bold">Friend requests</h2>
    {incoming === null || outgoing === null ? <p className="text-sm text-zinc-500">Couldn’t load your friend requests. Try again in a moment.</p>
      : empty ? <p className="text-sm text-zinc-500">No friend requests right now.</p>
      : <div className="grid gap-5">
          {incoming.items.length > 0 && <div>
            <h3 className={label}>Waiting for you</h3>
            <ul className="grid gap-2">{incoming.items.map((player) => <li key={player.id} className={row}>
              <Player player={player} />
              <div className="flex shrink-0 gap-2">
                <button type="button" aria-disabled={blocked} onClick={() => void answer(`${request(player.id)}/accept`, "POST")} className={primary}>Accept</button>
                <button type="button" aria-disabled={blocked} onClick={() => void answer(request(player.id), "DELETE")} className={secondary}>Decline</button>
              </div>
            </li>)}</ul>
            {incoming.next_offset !== null && <p className="mt-2 text-xs text-zinc-500">Showing your newest {shown}.</p>}
          </div>}
          {outgoing.items.length > 0 && <div>
            <h3 className={label}>Sent by you</h3>
            <ul className="grid gap-2">{outgoing.items.map((player) => <li key={player.id} className={row}>
              <Player player={player} />
              <button type="button" aria-disabled={blocked} onClick={() => void answer(request(player.id), "DELETE")} className={`${secondary} shrink-0`}>Cancel</button>
            </li>)}</ul>
            {outgoing.next_offset !== null && <p className="mt-2 text-xs text-zinc-500">Showing your newest {shown}.</p>}
          </div>}
        </div>}
    <p aria-live="polite" className="mt-2 text-xs text-[#f37981]">{error}</p>
  </section>;
}
