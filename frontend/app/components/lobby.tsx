"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { parseChallengeToday, type ChallengeToday } from "../lib/protocol";
import MatchmakingCard from "./matchmaking-card";
import ArenaStatsCard from "./arena-stats";
import { useSession } from "./providers/session-provider";
import TagDialog from "./tag-dialog";
import PageHeader from "./page-header";
import Skeleton from "./skeleton";
import ErrorState from "./error-state";
import EmptyState from "./empty-state";
import { buttonClass } from "./button";

export default function Lobby() {
  const { user, status: session, setUser, logout, loggingOut, logoutError } = useSession();
  const [challenge, setChallenge] = useState<ChallengeToday | null>(null);
  const [challengeError, setChallengeError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (session !== "in") return;
    const controller = new AbortController();
    api("/v1/challenge/today", controller.signal)
      .then(data => { if (!controller.signal.aborted) setChallenge(parseChallengeToday(data)); })
      .catch(() => { if (!controller.signal.aborted) setChallengeError(true); });
    return () => controller.abort();
  }, [session, attempt]);

  return (
    <>
        <main aria-labelledby="lobby-title" className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col px-gutter py-8">
          <PageHeader id="lobby-title" title="Find a debate" description="Choose an arena, write one prompt, and let your AI argue your side." />
          <div className="grid items-start gap-stack lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <section aria-label="Matchmaking" className="min-w-0">
              <MatchmakingCard key={session} />
            </section>
            <section aria-labelledby="daily-title" className="panel min-w-0 p-panel">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="daily-title" className="text-base font-bold">Daily challenge</h2>
                {challenge && <span className={`text-xs font-semibold ${challenge.completed ? "text-win" : "text-gold"}`}>{challenge.completed ? "Completed today" : `+${challenge.reward_points} points`}</span>}
              </div>
              <div className="mt-5" aria-live="polite">
                {challengeError ? <ErrorState compact message="Couldn’t load today’s challenge." retryLabel="Retry challenge" onRetry={() => { setChallengeError(false); setAttempt(value => value + 1); }} />
                  : !challenge ? <Skeleton label="Loading today’s challenge…" variant="lines" count={4} />
                  : !challenge.topic ? <EmptyState title="No challenge topic available">Check back later for today’s challenge.</EmptyState>
                  : <>
                    <h3 className="text-2xl font-bold leading-tight break-words">{challenge.topic.topic}</h3>
                    <div className="mt-5 border-t border-line pt-4">
                      <p className="eyebrow">Today’s twist</p>
                      <p className="mt-2 text-sm font-semibold">{challenge.twist.title}</p>
                      <p className="mt-1 text-sm leading-relaxed text-ink-muted break-words">{challenge.twist.description}</p>
                    </div>
                    <p className="mt-4 text-xs leading-relaxed text-ink-faint">{challenge.completed ? "You’ve earned today’s bonus. Come back tomorrow for a new topic and twist." : "Finish a challenge debate to earn the bonus, once per day."}</p>
                    <Link href="/challenge" className={buttonClass("secondary", "md", "mt-5")}>{challenge.completed ? "View today’s challenge" : "Play daily challenge"}</Link>
                  </>}
              </div>
            </section>
          </div>
          {session === "in" && user && <div className="mt-stack"><ArenaStatsCard key={user.id} /></div>}
        </main>
      {session === "in" && user?.tag === null && <TagDialog onCreated={setUser} onSignOut={logout} signingOut={loggingOut} signOutError={logoutError} />}
    </>
  );
}
