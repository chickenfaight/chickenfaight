"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { parseChallengeToday, type ChallengeToday } from "../lib/protocol";
import { SIDE_LABEL, SIDE_TEXT } from "../lib/matches";
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
  const router = useRouter();
  const [challenge, setChallenge] = useState<ChallengeToday | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const now = useNow(30000);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const data = parseChallengeToday(await api("/v1/challenge/today", controller.signal));
        if (!controller.signal.aborted) { setChallenge(data); setError(""); }
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError && err.status === 401) { router.replace("/login"); return; }
        setError("Couldn’t load today’s challenge.");
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt, router]);

  if (error) return <ErrorState message={error} onRetry={() => setAttempt((n) => n + 1)} />;
  if (!challenge) return <Skeleton label="Loading today’s challenge…" variant="block" height="h-96" />;

  return <div className="grid gap-stack lg:grid-cols-[minmax(0,1fr)_340px]">
    <section aria-labelledby="challenge-topic" className="panel p-panel animate-rise xl:p-9">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="eyebrow text-gold">{challenge.day}</p>
        <p className="text-xs text-ink-faint">Resets in <span className="stat text-lg text-ink">{untilReset(challenge.resets_at, now)}</span></p>
      </div>
      <h2 id="challenge-topic" className="mt-4 text-3xl font-black tracking-tight">{challenge.topic?.topic ?? "No topic available today"}</h2>
      {challenge.topic && <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {(["pro", "con"] as const).map((side) => <p key={side} className="well p-4 text-sm leading-relaxed"><span className={`stat mb-1.5 block text-base uppercase tracking-wider ${SIDE_TEXT[side]}`}>{SIDE_LABEL[side]}</span>{challenge.topic![`${side}_position`]}</p>)}
      </div>}
      <div className="mt-6 rounded-inset border border-gold/30 bg-gold/[0.06] p-5">
        <p className="eyebrow text-gold">Today’s twist</p>
        <p className="mt-1.5 text-base font-bold">{challenge.twist.title}</p>
        <p className="mt-1 text-sm text-ink-muted">{challenge.twist.description}</p>
      </div>
      <p className="mt-6 text-sm leading-relaxed text-ink-muted">Finish a challenge match today to earn <span className="stat text-lg text-ink">{challenge.reward_points} points</span>, once per day. You&apos;ll be matched with another player taking today&apos;s challenge on the same model; you&apos;re randomly assigned a side.</p>
    </section>
    <aside aria-label="Join today’s challenge" className="animate-rise [animation-delay:80ms]">
      {challenge.completed
        ? <div className="panel p-panel text-center"><p className="stat text-5xl text-win">Done</p><p className="mt-3 text-sm font-bold">Completed today</p><p className="mt-1 text-xs text-ink-muted">A new challenge starts in {untilReset(challenge.resets_at, now)}.</p></div>
        : <MatchmakingCard daily onChallengeDone={() => setAttempt((n) => n + 1)} />}
    </aside>
  </div>;
}
