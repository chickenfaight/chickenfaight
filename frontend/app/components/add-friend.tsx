"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { parseFriendshipStatus, type FriendRequestState } from "../lib/protocol";
import { useFriendRequests } from "./providers/friend-requests-provider";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";
const button = `rounded-full px-5 py-2 text-sm font-bold transition-colors aria-disabled:cursor-not-allowed aria-disabled:opacity-50 ${focus}`;
const primary = `${button} bg-[#e53848] text-white not-aria-disabled:hover:bg-[#c92d3c]`;
const secondary = `${button} border border-white/20 text-white not-aria-disabled:hover:bg-white/10`;

type Relation = "none" | "friends" | NonNullable<FriendRequestState>;

type Props = {
  userId: string;
  initialIsFriend: boolean;
  initialRequest: FriendRequestState;
};

// The viewer's friendship with another player: ask, answer their request, or end it.
export default function AddFriendButton({ userId, initialIsFriend, initialRequest }: Props) {
  const router = useRouter();
  const { refresh: recount } = useFriendRequests();
  const controller = useRef<AbortController | null>(null);
  const [relation, setRelation] = useState<Relation>(initialIsFriend ? "friends" : initialRequest ?? "none");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => controller.current?.abort(), []);

  const id = encodeURIComponent(userId);

  // Each action resolves to the relationship it leaves behind.
  async function run(action: (signal: AbortSignal) => Promise<Relation>) {
    if (pending) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setPending(true);
    setError("");
    try {
      setRelation(await action(current.signal));
      void recount();
    } catch (err) {
      if (current.signal.aborted) return;
      if (err instanceof ApiError && err.status === 401) { router.replace("/login"); return; }
      if (err instanceof ApiError && err.code === "NOT_FOUND") { setRelation("none"); void recount(); }
      setError(err instanceof ApiError && err.status === 429 ? "Too many changes. Wait a moment and try again."
        : err instanceof ApiError && err.code === "NOT_FOUND" ? "That request is no longer open."
        : err instanceof ApiError && err.code === "TAG_REQUIRED" ? "Create your tag before adding friends."
        : "Couldn’t update friends. Try again.");
    } finally {
      if (!current.signal.aborted) setPending(false);
    }
  }

  const send = () => run(async (signal) => {
    const status = parseFriendshipStatus(await api(`/v1/friends/requests/${id}`, signal, "PUT"));
    return status.is_friend ? "friends" : status.friend_request ?? "none";
  });
  const accept = () => run(async (signal) => { await api(`/v1/friends/requests/${id}/accept`, signal, "POST"); return "friends"; });
  const clearRequest = () => run(async (signal) => { await api(`/v1/friends/requests/${id}`, signal, "DELETE"); return "none"; });
  const remove = () => run(async (signal) => { await api(`/v1/friends/${id}`, signal, "DELETE"); return "none"; });

  return (
    <div className="mt-4">
      {relation === "received" && <p className="mb-2 text-xs text-zinc-400">Wants to be your friend.</p>}
      {relation === "sent" && <p className="mb-2 text-xs text-zinc-400">Friend request sent.</p>}
      {/* aria-disabled, not disabled: Firefox restores a stale disabled state on reload (frontend/AGENTS.md). */}
      <div className="flex gap-2">
        {relation === "none" && <button type="button" onClick={send} aria-disabled={pending} className={primary}>Add friend</button>}
        {relation === "sent" && <button type="button" onClick={clearRequest} aria-disabled={pending} className={secondary}>Cancel request</button>}
        {relation === "received" && <>
          <button type="button" onClick={accept} aria-disabled={pending} className={primary}>Accept</button>
          <button type="button" onClick={clearRequest} aria-disabled={pending} className={secondary}>Decline</button>
        </>}
        {relation === "friends" && <button type="button" onClick={remove} aria-disabled={pending} className={secondary}>Remove friend</button>}
      </div>
      <p aria-live="polite" className="mt-2 text-xs text-[#f37981]">{error}</p>
    </div>
  );
}
