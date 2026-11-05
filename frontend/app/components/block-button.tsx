"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";
const button = `rounded-full px-5 py-2 text-sm font-bold transition-colors aria-disabled:cursor-not-allowed aria-disabled:opacity-50 ${focus}`;
const primary = `${button} bg-[#e53848] text-white not-aria-disabled:hover:bg-[#c92d3c]`;
const secondary = `${button} border border-white/20 text-white not-aria-disabled:hover:bg-white/10`;

type Props = {
  userId: string;
  initialIsBlocked: boolean;
};

// The viewer's block status with another player; based on friendship system, simplified with less mutual interaction.
export default function BlockButton({ userId, initialIsBlocked }: Props) {
  const router = useRouter();
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
    } catch (err) {
      if (current.signal.aborted) return;
      if (err instanceof ApiError && err.status === 401) { router.replace("/login"); return; }
      if (err instanceof ApiError && err.code === "NOT_FOUND") { setBlocked(false); }
      setError(err instanceof ApiError && err.status === 429 ? "Too many changes. Wait a moment and try again."
        : err instanceof ApiError && err.code === "NOT_FOUND" ? "That request is no longer open."
        : err instanceof ApiError && err.code === "TAG_REQUIRED" ? "Create your tag before blocking players."
        : "Couldn’t update block status. Try again.");
    } finally {
      if (!current.signal.aborted) setPending(false);
    }
  }

  const block = () => run(async (signal) => {
    const status = await api(`/v1/block/${id}`, signal, "PUT");
    return status ?? false;
  });
  const unblock = () => run(async (signal) => {
    const status = await api(`/v1/block/${id}`, signal, "DELETE");
    return status ?? false;
  });

  return (
    <div className="mt-4">
      {/* aria-disabled, not disabled: Firefox restores a stale disabled state on reload (frontend/AGENTS.md). */}
      <div className="flex gap-2">
        {!isBlocked && <button type="button" onClick={block} aria-disabled={pending} className={primary}>Block</button>}
        {isBlocked && <button type="button" onClick={unblock} aria-disabled={pending} className={secondary}>Unblock</button>}
      </div>
      {isBlocked && <p className="mb-2 text-xs text-zinc-400">They can't see your profile.</p>}
      <p aria-live="polite" className="mt-2 text-xs text-[#f37981]">{error}</p>
    </div>
  );
}
