"use client";

import { useEffect, useState } from "react";
import Button from "./button";
import PopoverMenu from "./popover-menu";
import { queueName, type useQueue } from "./providers/queue-provider";

export function QueueElapsed({ since, className }: { since: number; className?: string }) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const tick = () => setNow(performance.now());
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - since) / 1000));
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return <span role="timer" aria-label="Time in queue" aria-live="off" className={className}>
    {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
  </span>;
}

export default function QueueStatusIndicator({ status }: { status: ReturnType<typeof useQueue> }) {
  const { queue, phase, error, retry, cancel } = status;
  const label = phase === "matched" ? "Opponent found. Entering the arena…"
    : phase === "finishing" ? "Waiting for your previous debate to end…"
    : phase === "joining" ? "Joining queue…"
      : phase === "cancelling" ? "Cancelling queue…"
        : phase === "checking" ? "Checking queue…"
          : phase === "error" ? "Queue status unavailable"
            : "Finding an opponent…";
  const waiting = queue && phase !== "matched";
  const summary = phase === "error" ? "Queue issue" : phase === "matched" ? "Match found"
    : phase === "finishing" ? "Finishing debate" : phase === "joining" ? "Joining…"
      : phase === "cancelling" ? "Cancelling…" : phase === "checking" ? "Checking…"
        : queue?.mode === "daily" ? "Daily queue" : "In queue";
  const arena = queue ? queueName(queue) : null;
  const headerArena = queue?.mode === "daily" ? queue.modelName : arena;
  return <section aria-label="Matchmaking queue" className="min-w-0 sm:ml-auto">
    <span role="status" className="sr-only">{label}</span>
    <PopoverMenu label="Queue details" openOnHover={false}
      buttonClassName="flex h-11 max-w-full items-center rounded-control border border-line-strong bg-inset px-2 text-xs font-semibold text-ink hover:border-ink-faint focus-ring sm:px-3"
      button={<span className="grid min-w-0 gap-0.5 text-left leading-tight">
        <span className="flex min-w-0 items-center justify-between gap-1.5 sm:gap-3">
          <span className="truncate">{summary}</span>
          {waiting && <QueueElapsed since={queue.elapsedSince} className="stat shrink-0 text-base text-accent-ink" />}
        </span>
        {headerArena && <span className="max-w-56 truncate font-medium text-ink-muted">{headerArena}</span>}
      </span>}>
      <div className="px-2 py-1.5">
        <p className="font-semibold">{label}</p>
        {arena && <p className="mt-1 wrap-anywhere text-ink-muted">{arena}</p>}
        {phase === "error" && <p role="alert" className="mt-2 text-danger">{error}</p>}
        {(phase === "error" || waiting) && <div className="mt-3 grid gap-2">
          {phase === "error" && <Button size="sm" onClick={retry}>Retry queue status</Button>}
          {waiting && <Button size="sm" aria-disabled={phase === "cancelling"} onClick={cancel}>{phase === "cancelling" ? "Cancelling…" : "Cancel queue"}</Button>}
        </div>}
      </div>
    </PopoverMenu>
  </section>;
}
