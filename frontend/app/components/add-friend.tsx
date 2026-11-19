"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "../lib/api";
import { parseFriendshipStatus, type FriendRequestState } from "../lib/protocol";
import { buttonClass } from "./button";
import { useFriendRequests } from "./providers/friend-requests-provider";

const primary = buttonClass("primary", "md");
const secondary = buttonClass("secondary", "md");

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
  const [relation, setRelation] = useState<Relation>(initialIsFriend ? "friends" : initialRequest ?? "none");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const id = encodeURIComponent(userId);

  // The click owns the mutation. Effect cleanup can replay while it is in flight.
  async function run(action: () => Promise<Relation>) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      setRelation(await action());
      void recount();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { router.replace("/login"); return; }
      if (err instanceof ApiError && err.code === "NOT_FOUND") { setRelation("none"); void recount(); }
      setError(err instanceof ApiError && err.status === 429 ? "Too many changes. Wait a moment and try again."
        : err instanceof ApiError && err.code === "NOT_FOUND" ? "That request is no longer open."
        : err instanceof ApiError && err.code === "TAG_REQUIRED" ? "Create your tag before adding friends."
        : "Couldn’t update friends. Try again.");
    } finally {
      setPending(false);
    }
  }

  const send = () => run(async () => {
    const status = parseFriendshipStatus(await api(`/v1/friends/requests/${id}`, undefined, "PUT"));
    return status.is_friend ? "friends" : status.friend_request ?? "none";
  });
  const accept = () => run(async () => { await api(`/v1/friends/requests/${id}/accept`, undefined, "POST"); return "friends"; });
  const clearRequest = () => run(async () => { await api(`/v1/friends/requests/${id}`, undefined, "DELETE"); return "none"; });
  const remove = () => run(async () => { await api(`/v1/friends/${id}`, undefined, "DELETE"); return "none"; });

  const status = relation === "sent" ? "Friend request sent." : relation === "received" ? "Wants to be your friend." : "";

  return (
    <div className="min-w-0">
      {/* aria-disabled, not disabled: Firefox restores a stale disabled state on reload (frontend/AGENTS.md). */}
      <div className="flex flex-wrap gap-2">
        {relation === "none" && <button type="button" onClick={send} aria-disabled={pending} className={primary}>Add friend</button>}
        {relation === "sent" && <button type="button" onClick={clearRequest} aria-disabled={pending} className={secondary}>Cancel request</button>}
        {relation === "received" && <>
          <button type="button" onClick={accept} aria-disabled={pending} className={primary}>Accept</button>
          <button type="button" onClick={clearRequest} aria-disabled={pending} className={secondary}>Decline</button>
        </>}
        {relation === "friends" && <button type="button" onClick={remove} aria-disabled={pending} className={secondary}>Remove friend</button>}
      </div>
      <p aria-live="polite" className={`text-xs not-empty:mt-2 ${error ? "text-danger" : "text-ink-muted"}`}>{error || status}</p>
    </div>
  );
}
