"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { api, ApiError } from "../lib/api";
import { displayName, type UserPage, type UserPublic } from "../lib/protocol";
import { profileHref } from "../lib/routes";
import Avatar from "./avatar";
import { buttonClass } from "./button";
import ErrorState from "./error-state";
import { useFriendRequests } from "./providers/friend-requests-provider";

const secondary = buttonClass("secondary", "sm");

function Player({ player }: { player: UserPublic }) {
  return <Link href={profileHref(player.tag)} className="group flex min-w-0 flex-1 basis-36 items-center gap-3 rounded-control focus-ring">
    <Avatar name={displayName(player)} url={player.avatar_url} size={40} />
    <span className="min-w-0"><span className="block truncate text-sm font-bold group-hover:underline">{displayName(player)}</span><span className="block truncate text-xs text-ink-faint">@{player.tag}</span></span>
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
  const count = (incoming?.items.length ?? 0) + (outgoing?.items.length ?? 0);
  const failed = incoming === null || outgoing === null;
  if (count === 0) return failed
    ? <ErrorState compact className="mb-4" message="Couldn’t load friend requests." onRetry={() => { if (!blocked) startRefresh(() => router.refresh()); }} />
    : null;

  const more = incoming?.next_offset != null || outgoing?.next_offset != null;
  const row = "flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-line pb-3 last:border-0 last:pb-0";
  const label = "eyebrow mb-2";

  return <details className="mb-4">
    <summary className="w-fit cursor-pointer rounded-control text-xs font-semibold text-accent-ink hover:underline focus-ring">
      {count}{more ? "+" : ""} pending friend {count === 1 && !more ? "request" : "requests"}
    </summary>
    <div className="mt-3 grid gap-4">
      {incoming && incoming.items.length > 0 && <div>
        <h3 className={label}>Waiting for you</h3>
        <ul className="grid gap-2">{incoming.items.map((player) => <li key={player.id} className={row}>
          <Player player={player} />
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-label={`Accept friend request from ${displayName(player)}`} aria-disabled={blocked} onClick={() => void answer(`${request(player.id)}/accept`, "POST")} className={secondary}>Accept</button>
            <button type="button" aria-label={`Decline friend request from ${displayName(player)}`} aria-disabled={blocked} onClick={() => void answer(request(player.id), "DELETE")} className={buttonClass("ghost", "sm")}>Decline</button>
          </div>
        </li>)}</ul>
        {incoming.next_offset !== null && <p className="mt-2 text-xs text-ink-faint">Showing your newest {shown}.</p>}
      </div>}
      {outgoing && outgoing.items.length > 0 && <div>
        <h3 className={label}>Sent by you</h3>
        <ul className="grid gap-2">{outgoing.items.map((player) => <li key={player.id} className={row}>
          <Player player={player} />
          <button type="button" aria-label={`Cancel friend request to ${displayName(player)}`} aria-disabled={blocked} onClick={() => void answer(request(player.id), "DELETE")} className={`${secondary} shrink-0`}>Cancel</button>
        </li>)}</ul>
        {outgoing.next_offset !== null && <p className="mt-2 text-xs text-ink-faint">Showing your newest {shown}.</p>}
      </div>}
    </div>
    {failed && <ErrorState compact className="mt-3" message="Couldn’t load all friend requests." onRetry={() => { if (!blocked) startRefresh(() => router.refresh()); }} />}
    <p aria-live="polite" className={`mt-2 text-xs ${error ? "text-danger" : "text-ink-faint"}`}>{error || (blocked ? "Updating friend requests…" : "")}</p>
  </details>;
}
