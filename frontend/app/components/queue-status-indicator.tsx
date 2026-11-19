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
  const busy = phase === "queued" || phase === "joining" || phase === "checking" || phase === "cancelling";
  const cancelling = phase === "cancelling";
  return <section aria-label="Matchmaking queue" className="w-64 min-w-0 rounded-control border border-accent/35 bg-surface sm:ml-auto">
    <span role="status" className="sr-only">{label}</span>
    <PopoverMenu label="Queue details" openOnHover={false}
      buttonClassName={`relative z-0 flex h-8.5 w-full items-center gap-1.5 bg-accent-wash px-1.5 text-left text-xs font-semibold leading-tight text-ink transition-colors hover:bg-accent/20 focus-visible:z-10 focus-visible:outline-offset-0 focus-ring sm:gap-2.5 sm:px-2.5 xl:h-10 ${waiting ? "rounded-t-[calc(var(--radius-control)-1px)]" : "rounded-[calc(var(--radius-control)-1px)]"}`}
      button={<>
        {busy && <span aria-hidden="true" className="size-4 shrink-0 rounded-full border-2 border-accent-ink/25 border-t-accent-ink motion-safe:animate-spin sm:size-5" />}
        <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-1 sm:gap-x-2">
          <span className="truncate">{summary}</span>
          {waiting && <QueueElapsed since={queue.elapsedSince} className="stat whitespace-nowrap text-base text-accent-ink sm:row-span-2 sm:text-2xl" />}
          {headerArena && <span className="col-span-full truncate font-medium text-ink-muted sm:col-span-1">{headerArena}</span>}
        </span>
      </>}>
      <div className="px-2 py-1.5">
        <p className="font-semibold">{label}</p>
        {arena && <p className="mt-1 wrap-anywhere text-ink-muted">{arena}</p>}
        {phase === "error" && <p role="alert" className="mt-2 text-danger">{error}</p>}
        {phase === "error" && <Button size="sm" className="mt-3" onClick={retry}>Retry queue status</Button>}
      </div>
    </PopoverMenu>
    {waiting && <button type="button" aria-disabled={cancelling} onClick={() => { if (!cancelling) cancel(); }}
      className="relative z-0 flex h-6 w-full items-center justify-center rounded-b-[calc(var(--radius-control)-1px)] border-t border-line bg-ink px-2 text-xs font-bold text-canvas transition-colors interactive:hover:bg-ink-muted aria-disabled:cursor-not-allowed aria-disabled:bg-ink-muted focus-visible:z-10 focus-visible:outline-offset-0 focus-ring xl:h-7">
      {cancelling ? "Cancelling…" : "Cancel queue"}
    </button>}
  </section>;
}
