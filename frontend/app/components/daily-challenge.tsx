"use client";

import { useEffect, useState } from "react";
import { SIDE_LABEL, SIDE_TEXT } from "../lib/matches";
import { useDailyChallenge } from "../lib/use-daily-challenge";
import Button from "./button";
import EmptyState from "./empty-state";
import ErrorState from "./error-state";
import MatchmakingCard from "./matchmaking-card";
import Skeleton from "./skeleton";

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function untilReset(resetsAt: string, now: number): string {
  const minutes = Math.max(0, Math.ceil((Date.parse(resetsAt) - now) / 60000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

// Today's daily challenge: topic, twist, reward, and a queue that only matches other challengers.
export default function DailyChallenge() {
  const { challenge, status, refresh } = useDailyChallenge();
  const now = useNow(30000);

  if (status === "error") return <ErrorState message="Couldn’t load today’s challenge." onRetry={refresh} />;
  if (!challenge) return <Skeleton label="Loading today’s challenge…" variant="block" height="h-96" />;
  const { topic, completed, resets_at: resetsAt } = challenge;
  if (!topic) return <EmptyState title="No topic available today" action={<Button onClick={refresh}>Check again</Button>}>
    Check back later for a new challenge.
  </EmptyState>;

  const positions = <div className="grid gap-3 sm:grid-cols-2">
    {(["pro", "con"] as const).map(side => <p key={side} className="well p-3 text-sm leading-relaxed">
      <span className={`mb-1 block font-semibold ${SIDE_TEXT[side]}`}>{SIDE_LABEL[side]}</span>{topic[`${side}_position`]}
    </p>)}
  </div>;

  return <div className="grid gap-stack lg:grid-cols-[minmax(0,1fr)_340px]">
    <section aria-labelledby="challenge-topic" className="panel min-w-0 wrap-anywhere p-panel animate-rise">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-gold">+{challenge.reward_points} points</p>
        <p className="text-sm text-ink-muted">Resets in <span className="stat text-lg text-ink">{untilReset(resetsAt, now)}</span></p>
      </div>
      <h2 id="challenge-topic" className="mt-4 text-balance text-3xl font-black tracking-tight">{topic.topic}</h2>
      <div className="mt-4 rounded-inset border border-gold/30 bg-gold/[0.06] p-4">
        <h3 className="text-base font-bold"><span className="text-gold">Today’s twist</span> · {challenge.twist.title}</h3>
        <p className="mt-1 text-sm text-ink-muted">{challenge.twist.description}</p>
      </div>
      <div className="mt-4 hidden lg:block">{positions}</div>
      <details className="mt-4 text-sm lg:hidden">
        <summary className="w-fit cursor-pointer rounded-control font-semibold text-ink-muted hover:text-ink focus-ring">See both sides</summary>
        <div className="mt-3">{positions}</div>
      </details>
      <p className="mt-4 text-sm leading-relaxed text-ink-muted">Choose a side when the debate starts. Finish the debate to earn today’s bonus.</p>
    </section>
    <aside aria-label="Challenge matchmaking" className="min-w-0 animate-rise [animation-delay:80ms]">
      {completed
        ? <div className="panel p-panel"><h2 className="text-base font-bold text-win">Completed today</h2><p className="mt-2 text-sm text-ink-muted">You earned the {challenge.reward_points}-point bonus.</p></div>
        : <MatchmakingCard daily onChallengeDone={refresh} />}
    </aside>
  </div>;
}
