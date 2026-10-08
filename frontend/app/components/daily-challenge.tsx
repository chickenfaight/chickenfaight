"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { parseChallengeToday, type ChallengeToday } from "../lib/protocol";
import MatchmakingCard from "./matchmaking-card";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";
const panel = "rounded-3xl border border-white/[0.07] bg-[#202124]";

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

  if (error) return <div className={`${panel} p-7`}><p role="alert" className="text-sm text-red-300">{error}</p><button onClick={() => setAttempt((n) => n + 1)} className={`mt-4 rounded-full border border-white/20 px-4 py-1.5 text-xs ${focus}`}>Try again</button></div>;
  if (!challenge) return <p role="status" className="text-sm text-zinc-400">Loading today’s challenge…</p>;

  return <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
    <section aria-labelledby="challenge-topic" className={`${panel} p-8`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#f0b84b]">{challenge.day} · resets in {untilReset(challenge.resets_at, now)}</p>
      <h2 id="challenge-topic" className="mt-3 text-3xl font-black tracking-[-0.04em]">{challenge.topic?.topic ?? "No topic available today"}</h2>
      {challenge.topic && <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <p className="rounded-2xl border border-white/[0.07] p-4 text-sm"><span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[var(--side-pro)]">Pro</span>{challenge.topic.pro_position}</p>
        <p className="rounded-2xl border border-white/[0.07] p-4 text-sm"><span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[var(--side-con)]">Con</span>{challenge.topic.con_position}</p>
      </div>}
      <div className="mt-6 rounded-2xl border border-[#f0b84b]/30 bg-[#f0b84b]/[0.06] p-5">
        <p className="text-sm font-bold text-[#f5d58a]">Today’s twist: {challenge.twist.title}</p>
        <p className="mt-1 text-sm text-zinc-300">{challenge.twist.description}</p>
      </div>
      <p className="mt-6 text-sm text-zinc-400">Finish a challenge match today to earn <span className="font-bold text-white">{challenge.reward_points} points</span>, once per day. You&apos;ll be matched with another player taking today&apos;s challenge on the same model; you&apos;re randomly assigned a side.</p>
    </section>
    <aside aria-label="Join today’s challenge">
      {challenge.completed
        ? <div className={`${panel} p-7 text-center`}><p className="text-3xl" aria-hidden="true">✓</p><p className="mt-2 text-sm font-bold">Completed today</p><p className="mt-1 text-xs text-zinc-400">A new challenge starts in {untilReset(challenge.resets_at, now)}.</p></div>
        : <MatchmakingCard daily onChallengeDone={() => setAttempt((n) => n + 1)} />}
    </aside>
  </div>;
}
