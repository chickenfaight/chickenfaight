"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { buttonClass } from "./button";
import { useFriendRequests } from "./providers/friend-requests-provider";

// Blocking is destructive, so it never takes the primary style from Add friend.
const danger = buttonClass("danger", "md");
const secondary = buttonClass("secondary", "md");

type Props = {
  userId: string;
  initialIsBlocked: boolean;
};

// The viewer's block status with another player; based on friendship system, simplified with less mutual interaction.
export default function BlockButton({ userId, initialIsBlocked }: Props) {
  const router = useRouter();
  const { refresh: recount } = useFriendRequests();
  const controller = useRef<AbortController | null>(null);
  const [isBlocked, setBlocked] = useState<boolean>(initialIsBlocked);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => controller.current?.abort(), []);

  const id = encodeURIComponent(userId);

  // Each action resolves to the relationship it leaves behind (here, the block boolean).
  async function run(action: (signal: AbortSignal) => Promise<boolean>) {
    if (pending) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setPending(true);
    setError("");
    try {
      setBlocked(await action(current.signal));
      // Blocking ends friendships and requests: reload the profile (the friend button
      // follows `is_blocked`) and the sidebar's request count.
      router.refresh();
      recount();
    } catch (err) {
      if (current.signal.aborted) return;
      if (err instanceof ApiError && err.status === 401) { router.replace("/login"); return; }
      setError(err instanceof ApiError && err.status === 429 ? "Too many changes. Wait a moment and try again."
        : err instanceof ApiError && err.code === "NOT_FOUND" ? "This player no longer exists."
        : "Couldn’t update block status. Try again.");
    } finally {
      if (!current.signal.aborted) setPending(false);
    }
  }

  const block = () => run(async (signal) => {
    await api(`/v1/block/${id}`, signal, "PUT");
    return true;
  });
  const unblock = () => run(async (signal) => {
    await api(`/v1/block/${id}`, signal, "DELETE");
    return false;
  });

  return (
    <div className="mt-4">
      {/* aria-disabled, not disabled: Firefox restores a stale disabled state on reload (frontend/AGENTS.md). */}
      <div className="flex gap-2">
        {!isBlocked && <button type="button" onClick={block} aria-disabled={pending} className={danger}>Block</button>}
        {isBlocked && <button type="button" onClick={unblock} aria-disabled={pending} className={secondary}>Unblock</button>}
      </div>
      {isBlocked && <p className="mt-2 text-xs text-ink-muted">They can&apos;t see your profile.</p>}
      <p aria-live="polite" className="mt-2 text-xs text-danger">{error}</p>
    </div>
  );
}
