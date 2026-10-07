"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";

type Props = {
  userId: string;
  initialIsFriend: boolean;
};

// Adds or removes another player from the viewer's friends list.
export default function AddFriendButton({ userId, initialIsFriend }: Props) {
  const router = useRouter();
  const controller = useRef<AbortController | null>(null);
  const [isFriend, setIsFriend] = useState(initialIsFriend);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => controller.current?.abort(), []);

  async function toggle() {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setPending(true);
    setError("");
    try {
      await api(`/v1/friends/${encodeURIComponent(userId)}`, current.signal, isFriend ? "DELETE" : "PUT");
      setIsFriend(!isFriend);
    } catch (err) {
      if (current.signal.aborted) return;
      if (err instanceof ApiError && err.status === 401) { router.replace("/login"); return; }
      setError(err instanceof ApiError && err.status === 429
        ? "Too many changes. Wait a moment and try again."
        : "Couldn’t update friends. Try again.");
    } finally {
      if (!current.signal.aborted) setPending(false);
    }
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={isFriend}
        className={`rounded-full px-5 py-2 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${focus} ${isFriend
          ? "border border-white/20 text-white enabled:hover:bg-white/10"
          : "bg-[#e53848] text-white enabled:hover:bg-[#c92d3c]"}`}
      >
        {isFriend ? "Remove friend" : "Add friend"}
      </button>
      <p aria-live="polite" className="mt-2 text-xs text-[#f37981]">{error}</p>
    </div>
  );
}
