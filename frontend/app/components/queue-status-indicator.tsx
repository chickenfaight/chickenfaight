"use client";

import { useEffect, useState } from "react";
import { queueName, type useQueue } from "./providers/queue-provider";

export function QueueSearchRing() {
  return <span aria-hidden="true" className="size-7 shrink-0 rounded-full border-[3px] border-accent/20 border-t-accent motion-safe:animate-spin" />;
}

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
          : phase === "error" ? error
            : "Finding an opponent…";
  const waiting = queue && phase !== "matched";
  const summary = phase === "error" ? "Queue issue" : phase === "matched" ? "Match found"
    : phase === "finishing" ? "Finishing debate" : phase === "joining" ? "Joining…"
      : phase === "cancelling" ? "Cancelling…" : phase === "checking" ? "Checking…"
        : queue?.mode === "daily" ? "Daily queue" : "In queue";
  const modelName = queue?.modelName?.replace(/^[^:]+: /, "") ?? null;
  const arena = queue?.mode === "daily" ? modelName : queue ? queueName({ ...queue, modelName }) : null;
  const busy = phase === "queued" || phase === "joining" || phase === "checking" || phase === "cancelling";
  const cancelling = phase === "cancelling";
  const compactDetails = phase === "queued" && !!arena;
  return <section aria-label="Matchmaking queue" className="@container grid h-12 w-96 min-w-0 grid-cols-[minmax(0,1fr)_auto] rounded-control border border-accent/35 bg-surface sm:ml-auto xl:h-14">
    <span role="status" className="sr-only">{label}</span>
    <div className={`flex min-w-0 items-center gap-1.5 bg-accent-wash px-1.5 py-1 text-xs font-semibold leading-tight text-ink @min-[17rem]:gap-2.5 @min-[17rem]:px-2.5 ${waiting ? "rounded-l-[calc(var(--radius-control)-1px)]" : "rounded-[calc(var(--radius-control)-1px)]"}`}>
      {busy && <QueueSearchRing />}
      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-1 @min-[17rem]:gap-x-2">
        <span className={`col-start-1 row-start-1 truncate ${compactDetails ? "@max-[17rem]:sr-only" : ""}`}>{summary}</span>
        {waiting && <QueueElapsed since={queue.elapsedSince} className={`stat col-start-2 row-start-1 whitespace-nowrap text-base leading-none text-accent-ink @min-[17rem]:row-span-2 @min-[17rem]:text-2xl ${compactDetails ? "@max-[17rem]:col-start-1" : ""}`} />}
        {phase === "error"
          ? <button type="button" aria-label="Retry queue status" onClick={retry} className="col-start-1 row-start-2 w-fit rounded-control text-accent-ink underline underline-offset-2 focus-ring">Retry</button>
          : arena && <span className="col-span-full row-start-2 truncate font-medium text-ink-muted @min-[17rem]:col-span-1">{arena}</span>}
      </div>
    </div>
    {waiting && <button type="button" aria-label="Cancel queue" aria-disabled={cancelling} onClick={() => { if (!cancelling) cancel(); }}
      className="relative z-0 min-w-11 rounded-r-[calc(var(--radius-control)-1px)] border-l border-line bg-surface-raised px-1.5 text-xs font-bold text-ink transition-colors interactive:hover:bg-accent-wash aria-disabled:cursor-not-allowed aria-disabled:text-ink-muted focus-visible:z-10 focus-visible:outline-offset-0 focus-ring @min-[17rem]:px-3">
      Cancel
    </button>}
  </section>;
}
