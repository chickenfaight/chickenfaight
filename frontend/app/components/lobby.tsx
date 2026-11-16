"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { parseChallengeToday, type ChallengeToday } from "../lib/protocol";
import Icon, { type IconName } from "./line-icon";
import InfoDialog, { type DetailTitle } from "./info-dialog";
import MatchmakingCard from "./matchmaking-card";
import ArenaStatsCard from "./arena-stats";
import { useSession } from "./providers/session-provider";
import AppShell from "./app-shell";
import SiteHeader from "./site-header";
import TagDialog from "./tag-dialog";

const card = "panel group flex flex-col p-5 text-left transition-[border-color,transform] duration-(--duration-base) ease-out hover:-translate-y-0.5 hover:border-line-strong focus-ring active:translate-y-0";

function CardTop({ icon, tone, note }: { icon: IconName; tone: string; note: string }) {
  return <span className="flex items-center justify-between gap-3">
    <span className={`flex h-9 w-9 items-center justify-center rounded-control ${tone}`}><Icon name={icon} /></span>
    <span className="text-xs text-ink-faint">{note}</span>
  </span>;
}

function CardTitle({ children }: { children: string }) {
  return <span className="mt-4 flex items-center justify-between text-sm font-bold">{children}<Icon name="arrow" className="h-4 w-4 text-ink-faint transition-[color,transform] duration-(--duration-base) group-hover:translate-x-0.5 group-hover:text-ink" /></span>;
}

export default function Lobby() {
  const { user, status: session, setUser, logout, loggingOut, logoutError } = useSession();
  const [detail, setDetail] = useState<DetailTitle | null>(null);
  const [challenge, setChallenge] = useState<ChallengeToday | null>(null);

  // Today's challenge for its card; the card still works as a link if this fails.
  useEffect(() => {
    if (session !== "in") return;
    const controller = new AbortController();
    api("/v1/challenge/today", controller.signal)
      .then((data) => { if (!controller.signal.aborted) setChallenge(parseChallengeToday(data)); })
      .catch(() => {});
    return () => controller.abort();
  }, [session]);

  return (
    <AppShell header={<SiteHeader current="play" />}>
      <main aria-labelledby="lobby-title" className="mx-auto flex w-full max-w-[1540px] flex-1 flex-col gap-stack px-gutter py-6">
        <div className="shrink-0 animate-rise"><p className="eyebrow mb-2 text-accent-ink">The debate arena</p><h1 id="lobby-title" className="headline text-4xl">Welcome to the coop.</h1></div>

        <div className="grid flex-1 grid-cols-[minmax(0,1fr)_300px] gap-stack max-[900px]:grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section aria-labelledby="play-title" className="panel flex min-h-[300px] items-center p-panel xl:p-10">
            <div className="grid w-full grid-cols-[1fr_minmax(0,0.9fr)] items-center gap-8 max-[1100px]:grid-cols-1">
              <div className="animate-rise">
                <p className="eyebrow">1v1 · AI debates</p>
                <h2 id="play-title" className="headline mt-4 text-7xl leading-[0.92]">Small prompt.<br /><span className="text-accent">Big fight.</span></h2>
                <p className="mt-5 max-w-72 text-sm leading-relaxed text-ink-muted">Write your prompt. Let your AI do the talking. A battle of wits, one debate at a time.</p>
              </div>
              <MatchmakingCard key={session} />
            </div>
          </section>

          <aside className="flex flex-col gap-stack" aria-label="Your performance">
            {session === "in" && user && <ArenaStatsCard key={user.id} />}
            <button type="button" onClick={() => setDetail("How to play")} className={`${card} flex-row items-center gap-3 p-4`}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-accent-wash text-accent-ink"><Icon name="bolt" /></span>
              <span className="flex-1"><span className="block text-sm font-bold">First time in the arena?</span><span className="mt-0.5 block text-xs text-ink-muted">Learn the rules in 30 seconds.</span></span>
              <Icon name="arrow" className="h-4 w-4 text-ink-faint transition-transform duration-(--duration-base) group-hover:translate-x-0.5" />
            </button>
          </aside>
        </div>

        <section aria-label="Explore the arena" className="mt-4 grid shrink-0 grid-cols-3 gap-stack max-[900px]:grid-cols-1 xl:mt-6">
          <Link href="/challenge" className={card}>
            <CardTop icon="bolt" tone="bg-gold/10 text-gold" note={challenge?.completed ? "Completed today" : `+${challenge?.reward_points ?? 50} points`} />
            <CardTitle>Daily challenge</CardTitle>
            <span className="mt-2 block truncate text-sm text-ink-muted">{challenge?.topic?.topic ?? "One topic. A whole lot of opinions."}</span>
            <span className="mt-1 block truncate text-xs text-ink-faint">{challenge ? `Twist: ${challenge.twist.title}` : "A new twist every day."}</span>
          </Link>
          <Link href="/leaderboards" className={card}>
            <CardTop icon="trophy" tone="bg-accent-wash text-accent-ink" note="Per-model rankings" />
            <CardTitle>Leaderboards</CardTitle>
            <span className="mt-2 block text-sm text-ink-muted">See the top 50 players in each arena.</span>
          </Link>
          <button type="button" onClick={() => setDetail("Bring your own model")} className={card}>
            <CardTop icon="chip" tone="bg-side-pro/10 text-side-pro" note="Home grown battles" />
            <CardTitle>Bring your own model</CardTitle>
            <span className="mt-2 block text-sm text-ink-muted">Got a model with something to prove?</span>
            <span className="mt-1 block text-xs text-ink-faint">Your machine. Your model. Our arena.</span>
          </button>
        </section>
        <footer className="mt-4 flex shrink-0 items-center justify-between border-t border-line pt-5 text-xs text-ink-faint xl:mt-6"><span>All brains. A little bit of bird.</span><span>Chicken fAIght <span className="mx-2 text-line-strong">/</span> Made for a good argument.</span></footer>
      </main>
      {session === "in" && user?.tag === null && <TagDialog onCreated={setUser} onSignOut={logout} signingOut={loggingOut} signOutError={logoutError} />}
      <InfoDialog title={detail} onClose={() => setDetail(null)} />
    </AppShell>
  );
}
