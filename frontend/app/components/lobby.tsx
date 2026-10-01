"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { backendUrl } from "../lib/auth";
import { parseUser, type User } from "../lib/protocol";
import MatchmakingCard from "./matchmaking-card";
import UsernameDialog from "./username-dialog";

type IconName = "arrow" | "trophy" | "bolt" | "chip" | "chevron" | "cross";
const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";
const panel = "rounded-3xl border border-white/[0.07] bg-[#202124]";

function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  const paths: Record<IconName, React.ReactNode> = {
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    trophy: <><path d="M8 3h8v6a4 4 0 0 1-8 0V3Zm4 10v6m-4 2h8M8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4" /></>,
    bolt: <path d="m13 2-9 12h7l-1 8L20 9h-7l1-7Z" />,
    chip: <><rect x="6" y="6" width="12" height="12" rx="3" /><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4M10 10h4v4h-4z" /></>,
    chevron: <path d="m7 10 5 5 5-5" />,
    cross: <path d="m6 6 12 12M6 18 18 6" />,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{paths[name]}</svg>;
}

export default function Lobby() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<"loading" | "in" | "out" | "error">("loading");
  const [menu, setMenu] = useState(false);
  const [detail, setDetail] = useState("How to play");
  const [logoutError, setLogoutError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const profileButton = useRef<HTMLButtonElement>(null);
  const logoutController = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const res = await fetch(`${backendUrl}/auth/me`, { credentials: "include", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) });
        if (res.status === 401) { setSession("out"); return; }
        if (!res.ok) throw new Error("Session unavailable");
        setUser(parseUser(await res.json())); setSession("in");
      } catch { if (!controller.signal.aborted) setSession("error"); }
    }
    void load();
    return () => { controller.abort(); logoutController.current?.abort(); };
  }, []);

  function showDetail(title: string) { setDetail(title); dialog.current?.showModal(); }
  async function logout() {
    setLoggingOut(true); setLogoutError("");
    const controller = new AbortController(); logoutController.current = controller;
    try {
      const res = await fetch(`${backendUrl}/auth/logout`, { method: "POST", credentials: "include", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) });
      if (!res.ok) throw new Error("Logout failed");
      setUser(null); setSession("out"); setMenu(false);
    } catch { if (!controller.signal.aborted) setLogoutError("Couldn’t sign out. Try again."); }
    finally { if (!controller.signal.aborted) setLoggingOut(false); }
  }

  const details: Record<string, { intro: string; items: string[] }> = {
    "How to play": { intro: "Your words. Your strategy. Your AI.", items: ["Choose a model and join its matchmaking queue.", "Once matched, you’ll enter a separate debate page and write one prompt to guide your AI.", "Watch both AIs debate through opening, rebuttal, and closing arguments.", "An AI judge picks the winner. Your rating belongs to that model’s ladder."] },
    "Daily challenge": { intro: "One topic. Plenty of hot takes.", items: ["Today’s sample topic: Should AI-generated art count as art?", "Daily challenges are a design preview and aren’t playable yet. Standard 1v1 debates are the core game mode."] },
    "Your ladder": { intro: "A fresh climb with every model.", items: ["Each model has its own Elo ladder, so your results are compared on equal footing.", "The rating and results shown here are sample data. Per-model rankings and match history are coming soon."] },
    "Bring your own model": { intro: "Homegrown intelligence. Same arena.", items: ["The planned BYOM arena connects a model on your machine through BILC, the BYOM Interface Layer Client.", "Device pairing and the BYOM ladder are coming soon."] },
  };
  const content = details[detail];

  return (
    <div className="flex min-h-svh flex-col bg-[#17181b] font-sans text-[#f5f3ef] min-[1024px]:h-svh min-[1024px]:min-h-[800px]">
      <header className="z-20 flex h-16 shrink-0 xl:h-[76px] items-center justify-between border-b border-white/[0.07] px-6 xl:px-10">
        <Link href="/" className={`flex items-center gap-2.5 rounded-xl ${focus}`} aria-label="Chicken fAIght home"><span className="text-[#f04b58]"></span><span className="text-xl font-extrabold tracking-[-0.06em]">chicken<span className="text-[#f04b58]">fAIght</span><span className="text-[#f04b58]">.</span></span></Link>
        <nav aria-label="Main navigation" className="flex h-full items-center gap-8 text-sm font-semibold">
          <Link href="/" aria-current="page" className={`flex h-full items-center border-b-2 border-[#f04b58] text-white ${focus}`}>Play</Link>
          <button onClick={() => showDetail("Your ladder")} className={`text-zinc-400 hover:text-white ${focus}`}>Leaderboards</button>
          <button onClick={() => showDetail("How to play")} className={`text-zinc-400 hover:text-white ${focus}`}>How to play</button>
        </nav>
        <div className="relative" onMouseEnter={() => setMenu(true)} onMouseLeave={() => setMenu(false)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setMenu(false); }} onKeyDown={(event) => { if (event.key === "Escape") { setMenu(false); profileButton.current?.focus(); } }}>
          <button ref={profileButton} aria-expanded={menu} aria-controls="profile-options" onClick={() => setMenu(true)} className={`flex items-center gap-3 rounded-xl px-2 py-2 text-left ${focus}`}>
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-[#f04b58]/30 bg-[#f04b58]/10 text-sm font-bold text-[#ff7882]">{user?.username?.slice(0, 2).toUpperCase() || "CF"}</span>
            <span><span className="block max-w-36 truncate text-xs font-bold">{user?.username || (session === "in" ? "Player" : "Guest player")}</span><span className="mt-1 block text-[10px] text-zinc-400">{session === "loading" ? "Checking session…" : session === "error" ? "Session unavailable" : user ? `${user.elo.toLocaleString()} Elo` : "Lobby preview"}</span></span>
            <Icon name="chevron" className="h-4 w-4 text-zinc-400" />
          </button>
          {menu && <div id="profile-options" className="absolute right-0 top-full w-56 pt-2"><div className={`${panel} p-2 text-sm`}>
            {session === "in" ? <><Link href="/profile" className={`block rounded-xl px-4 py-3 hover:bg-white/5 ${focus}`}>My profile</Link><button onClick={() => showDetail("Your ladder")} className={`w-full rounded-xl px-4 py-3 text-left hover:bg-white/5 ${focus}`}>My ladder</button><button disabled={loggingOut} onClick={logout} className={`w-full rounded-xl px-4 py-3 text-left text-[#ff7882] hover:bg-white/5 disabled:opacity-50 ${focus}`}>{loggingOut ? "Signing out…" : "Sign out"}</button></> : <Link href="/login" className={`block rounded-xl px-4 py-3 hover:bg-white/5 ${focus}`}>Sign in with Google</Link>}
            {logoutError && <p role="alert" className="px-4 py-2 text-xs text-red-300">{logoutError}</p>}
          </div></div>}
        </div>
      </header>

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
            <button onClick={() => showDetail("How to play")} className={`${panel} flex items-center gap-3 p-4 text-left hover:border-white/20 ${focus}`}><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#f04b58]/10 text-[#ff7882]"><Icon name="bolt" /></span><span className="flex-1"><span className="block text-xs font-bold">First time in the arena?</span><span className="mt-1 block text-[10px] text-zinc-400">Learn the rules in 30 seconds.</span></span><Icon name="arrow" className="h-4 w-4 text-zinc-500" /></button>
          </aside>
        </div>

        <section aria-label="Explore the arena" className="grid shrink-0 grid-cols-3 gap-5">
          {([
            { title: "Daily challenge", icon: "bolt", tag: "Coming soon", text: "Should AI-generated art count as art?", sub: "One topic. A whole lot of opinions.", color: "text-[#e5b96b] bg-[#e5b96b]/10" },
            { title: "Your ladder", icon: "trophy", tag: "Per-model rankings", text: "Small steps. Big pecking order.", sub: "Make your mark on every model’s ladder.", color: "text-[#ff7882] bg-[#f04b58]/10" },
            { title: "Bring your own model", icon: "chip", tag: "Coming soon", text: "Got a model with something to prove?", sub: "Your machine. Your model. Our arena.", color: "text-[#b5a4d9] bg-[#b5a4d9]/10" },
          ] as const).map((card) => <button key={card.title} onClick={() => showDetail(card.title)} className={`${panel} group p-4 xl:p-5 text-left hover:border-white/20 ${focus}`}><span className="flex items-center justify-between"><span className={`flex h-9 w-9 items-center justify-center rounded-xl ${card.color}`}><Icon name={card.icon} /></span><span className="text-[9px] text-zinc-500">{card.tag}</span></span><span className="mt-3 flex items-center justify-between text-sm font-bold">{card.title}<Icon name="arrow" className="h-4 w-4 text-zinc-500 group-hover:text-white" /></span><span className="mt-2 block text-xs text-zinc-300">{card.text}</span><span className="mt-1 block text-[11px] text-zinc-500">{card.sub}</span></button>)}
        </section>
        <footer className="flex shrink-0 items-center justify-between text-[10px] text-zinc-500"><span>All brains. A little bit of bird.</span><span>Chicken fAIght <span className="mx-2 text-zinc-700">/</span> Made for a good argument.</span></footer>
      </main>
      {session === "in" && user?.username === null && <UsernameDialog onCreated={setUser} onSignOut={logout} signingOut={loggingOut} signOutError={logoutError} />}
      <dialog ref={dialog} aria-labelledby="detail-title" className="fixed inset-0 m-auto w-[min(520px,90vw)] rounded-3xl border border-white/10 bg-[#202124] p-8 text-[#f5f3ef] backdrop:bg-black/70">
        <div className="flex items-center justify-between gap-4"><h2 id="detail-title" className="text-xl font-bold">{detail}</h2><button autoFocus onClick={() => dialog.current?.close()} aria-label="Close" className={`rounded-xl p-2 hover:bg-white/5 ${focus}`}><Icon name="cross" /></button></div>
        <p className="mt-3 text-sm text-[#ff7882]">{content.intro}</p><ol className="mt-6 space-y-4">{content.items.map((item, i) => <li key={item} className="flex gap-3 text-sm leading-relaxed text-zinc-300"><span className="font-mono text-zinc-500">0{i + 1}</span>{item}</li>)}</ol>
      </dialog>
    </div>
  );
}
