"use client";

import { useState } from "react";
import Icon from "./line-icon";
import InfoDialog, { type DetailTitle } from "./info-dialog";
import MatchmakingCard from "./matchmaking-card";
import { useSession } from "./providers/session-provider";
import SiteHeader from "./site-header";
import TagDialog from "./tag-dialog";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";
const panel = "rounded-3xl border border-white/[0.07] bg-[#202124]";

export default function Lobby() {
  const { user, status: session, setUser, logout, loggingOut, logoutError } = useSession();
  const [detail, setDetail] = useState<DetailTitle | null>(null);

  return (
    <div className="flex min-h-svh flex-col bg-[#17181b] font-sans text-[#f5f3ef] min-[1024px]:h-svh min-[1024px]:min-h-[800px]">
      <SiteHeader current="play" />

      <main className="mx-auto flex w-full max-w-[1540px] flex-1 flex-col gap-4 px-6 py-4 xl:gap-6 xl:px-10 xl:py-6 min-[1024px]:min-h-0">
        <div className="flex shrink-0 items-end justify-between"><div><p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#f37981]">The debate arena</p><h1 className="text-2xl font-bold tracking-tight">Welcome to the coop.</h1></div></div>

        <div className="grid flex-1 grid-cols-[minmax(0,1fr)_280px] gap-5 max-[900px]:grid-cols-1 xl:grid-cols-[minmax(0,1fr)_310px] min-[1024px]:min-h-0">
          <section aria-labelledby="play-title" className={`${panel} relative flex min-h-[300px] items-center overflow-hidden p-5 xl:p-9`}>
            <div aria-hidden="true" className="pointer-events-none absolute -left-24 -top-48 h-[480px] w-[480px] rounded-full border-[65px] border-[#f04b58]/[0.035]" />
            <div className="relative grid w-full grid-cols-[1fr_0.9fr] items-center gap-6">
              <div><span className="inline-flex items-center gap-2 rounded-full border border-[#f04b58]/20 bg-[#f04b58]/[0.07] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#ff7882]"><span className="h-1.5 w-1.5 rounded-full bg-current" />1v1 · AI debates</span>
                <h2 id="play-title" className="mt-5 text-[clamp(38px,4.5vw,68px)] font-black leading-[1.02] tracking-[-0.065em]">Small prompt.<br /><span className="text-[#f04b58]">Big fight.</span></h2>
                <p className="mt-5 max-w-72 text-sm leading-relaxed text-zinc-400">Write your prompt. Let your AI do the talking. A battle of wits, one debate at a time.</p>
              </div>
              <MatchmakingCard key={session} />
            </div>
          </section>

          <aside className="flex flex-col gap-4" aria-label="Your performance">
            <section aria-labelledby="stats-title" className={`${panel} flex flex-1 flex-col justify-center p-5`}>
              <div className="mb-5 flex items-center justify-between"><h2 id="stats-title" className="text-sm font-bold">Your arena stats</h2><span className="text-[9px] uppercase tracking-wider text-zinc-500">Sample data</span></div>
              <div className="grid grid-cols-2 gap-y-5"><div><p className="text-[10px] text-zinc-400">Model Elo</p><p className="mt-1 text-2xl font-bold tracking-tight">1,240<span className="ml-2 text-[10px] font-medium text-emerald-400">+24</span></p></div><div><p className="text-[10px] text-zinc-400">Win rate</p><p className="mt-1 text-2xl font-bold tracking-tight">64<span className="text-base text-zinc-500">%</span></p></div><div><p className="text-[10px] text-zinc-400">Debates played</p><p className="mt-1 text-xl font-semibold">28</p></div><div><p className="text-[10px] text-zinc-400">Wins</p><p className="mt-1 text-xl font-semibold">18</p></div></div>
              <div className="mt-5 flex items-center justify-between border-t border-white/[0.07] pt-4"><span className="text-[10px] text-zinc-400">Recent form</span><div className="flex gap-1.5">{["W", "W", "L", "W", "W"].map((result, i) => <span key={i} className={`flex h-6 w-6 items-center justify-center rounded-md text-[9px] font-bold ${result === "W" ? "bg-emerald-400/10 text-emerald-400" : "bg-white/5 text-zinc-500"}`}>{result}</span>)}</div></div>
            </section>
            <button onClick={() => setDetail("How to play")} className={`${panel} flex items-center gap-3 p-4 text-left hover:border-white/20 ${focus}`}><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#f04b58]/10 text-[#ff7882]"><Icon name="bolt" /></span><span className="flex-1"><span className="block text-xs font-bold">First time in the arena?</span><span className="mt-1 block text-[10px] text-zinc-400">Learn the rules in 30 seconds.</span></span><Icon name="arrow" className="h-4 w-4 text-zinc-500" /></button>
          </aside>
        </div>

        <section aria-label="Explore the arena" className="grid shrink-0 grid-cols-3 gap-5">
          {([
            { title: "Daily challenge", icon: "bolt", tag: "Coming soon", text: "Should AI-generated art count as art?", sub: "One topic. A whole lot of opinions.", color: "text-[#e5b96b] bg-[#e5b96b]/10" },
            { title: "Your ladder", icon: "trophy", tag: "Per-model rankings", text: "Small steps. Big pecking order.", sub: "Make your mark on every model’s ladder.", color: "text-[#ff7882] bg-[#f04b58]/10" },
            { title: "Bring your own model", icon: "chip", tag: "Coming soon", text: "Got a model with something to prove?", sub: "Your machine. Your model. Our arena.", color: "text-[#b5a4d9] bg-[#b5a4d9]/10" },
          ] as const).map((card) => <button key={card.title} onClick={() => setDetail(card.title)} className={`${panel} group p-4 xl:p-5 text-left hover:border-white/20 ${focus}`}><span className="flex items-center justify-between"><span className={`flex h-9 w-9 items-center justify-center rounded-xl ${card.color}`}><Icon name={card.icon} /></span><span className="text-[9px] text-zinc-500">{card.tag}</span></span><span className="mt-3 flex items-center justify-between text-sm font-bold">{card.title}<Icon name="arrow" className="h-4 w-4 text-zinc-500 group-hover:text-white" /></span><span className="mt-2 block text-xs text-zinc-300">{card.text}</span><span className="mt-1 block text-[11px] text-zinc-500">{card.sub}</span></button>)}
        </section>
        <footer className="flex shrink-0 items-center justify-between text-[10px] text-zinc-500"><span>All brains. A little bit of bird.</span><span>Chicken fAIght <span className="mx-2 text-zinc-700">/</span> Made for a good argument.</span></footer>
      </main>
      {session === "in" && user?.tag === null && <TagDialog onCreated={setUser} onSignOut={logout} signingOut={loggingOut} signOutError={logoutError} />}
      <InfoDialog title={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
