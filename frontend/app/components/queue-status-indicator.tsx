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
  const modelName = queue?.modelName?.replace(/^[^:]+: /, "") ?? null;
  const arena = queue ? queueName({ ...queue, modelName }) : null;
  const headerArena = queue?.mode === "daily" ? modelName : arena;
  const busy = phase === "queued" || phase === "joining" || phase === "checking" || phase === "cancelling";
  const cancelling = phase === "cancelling";
  const compactDetails = phase === "queued" && !!headerArena;
  return <section aria-label="Matchmaking queue" className="@container grid h-12 w-96 min-w-0 grid-cols-[minmax(0,1fr)_auto] rounded-control border border-accent/35 bg-surface sm:ml-auto xl:h-14">
    <span role="status" className="sr-only">{label}</span>
    <PopoverMenu label="Queue details" openOnHover={false}
      buttonClassName={`relative z-0 flex h-full w-full items-center gap-1.5 bg-accent-wash px-1.5 py-1 text-left text-xs font-semibold leading-tight text-ink transition-colors hover:bg-accent/20 focus-visible:z-10 focus-visible:outline-offset-0 focus-ring @min-[17rem]:gap-2.5 @min-[17rem]:px-2.5 ${waiting ? "rounded-l-[calc(var(--radius-control)-1px)]" : "rounded-[calc(var(--radius-control)-1px)]"}`}
      button={<>
        {busy && <span aria-hidden="true" className="size-8 shrink-0 rounded-full border-2 border-accent-ink/25 border-t-accent-ink motion-safe:animate-spin sm:size-9 xl:size-11" />}
        <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-1 @min-[17rem]:gap-x-2">
          <span className={`col-start-1 row-start-1 truncate ${compactDetails ? "@max-[17rem]:sr-only" : ""}`}>{summary}</span>
          {waiting && <QueueElapsed since={queue.elapsedSince} className={`stat col-start-2 row-start-1 whitespace-nowrap text-base leading-none text-accent-ink @min-[17rem]:row-span-2 @min-[17rem]:text-2xl ${compactDetails ? "@max-[17rem]:col-start-1" : ""}`} />}
          {headerArena && <span className="col-span-full row-start-2 truncate font-medium text-ink-muted @min-[17rem]:col-span-1">{headerArena}</span>}
        </span>
      </>}>
      <div className="px-2 py-1.5">
        <p className="font-semibold">{label}</p>
        {arena && <p className="mt-1 wrap-anywhere text-ink-muted">{arena}</p>}
        {phase === "error" && <p role="alert" className="mt-2 text-danger">{error}</p>}
        {phase === "error" && <Button size="sm" className="mt-3" onClick={retry}>Retry queue status</Button>}
      </div>
    </PopoverMenu>
    {waiting && <button type="button" aria-label="Cancel queue" aria-disabled={cancelling} onClick={() => { if (!cancelling) cancel(); }}
      className="relative z-0 min-w-11 rounded-r-[calc(var(--radius-control)-1px)] border-l border-line bg-surface-raised px-1.5 text-xs font-bold text-ink transition-colors interactive:hover:bg-accent-wash aria-disabled:cursor-not-allowed aria-disabled:text-ink-muted focus-visible:z-10 focus-visible:outline-offset-0 focus-ring @min-[17rem]:px-3">
      Cancel
    </button>}
  </section>;
}
