"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import Icon from "./line-icon";
import InfoDialog, { type DetailTitle } from "./info-dialog";
import { useSession } from "./providers/session-provider";
import UserSearch from "./user-search";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";
const panel = "rounded-3xl border border-white/[0.07] bg-[#202124]";

// The app's top bar: wordmark, navigation, player search, and the profile menu.
export default function SiteHeader({ current, query }: { current?: "play"; query?: string }) {
  const { user, status: session, logout, loggingOut, logoutError } = useSession();
  const [menu, setMenu] = useState(false);
  const [detail, setDetail] = useState<DetailTitle | null>(null);
  const profileButton = useRef<HTMLButtonElement>(null);

  async function signOut() {
    if (await logout()) setMenu(false);
  }

  return (
    <>
      <header className="z-20 flex h-16 shrink-0 xl:h-[76px] items-center justify-between border-b border-white/[0.07] px-6 xl:px-10">
      <Link href="/" className={`flex items-center gap-2.5 rounded-xl ${focus}`} aria-label="Chicken fAIght home"><span className="text-[#f04b58]"></span><span className="text-xl font-extrabold tracking-[-0.06em]">chicken<span className="text-[#f04b58]">fAIght</span><span className="text-[#f04b58]">.</span></span></Link>
      <nav aria-label="Main navigation" className="flex h-full items-center gap-8 text-sm font-semibold">
        <Link href="/" aria-current={current === "play" ? "page" : undefined} className={`flex h-full items-center border-b-2 ${current === "play" ? "border-[#f04b58] text-white" : "border-transparent text-zinc-400 hover:text-white"} ${focus}`}>Play</Link>
        <button onClick={() => setDetail("Your ladder")} className={`text-zinc-400 hover:text-white ${focus}`}>Leaderboards</button>
        <button onClick={() => setDetail("How to play")} className={`text-zinc-400 hover:text-white ${focus}`}>How to play</button>
      </nav>
      <div className="flex items-center gap-4">
      <UserSearch key={query} initialQuery={query} />
      <div className="relative" onMouseEnter={() => setMenu(true)} onMouseLeave={() => setMenu(false)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setMenu(false); }} onKeyDown={(event) => { if (event.key === "Escape") { setMenu(false); profileButton.current?.focus(); } }}>
        <button ref={profileButton} aria-expanded={menu} aria-controls="profile-options" onClick={() => setMenu(true)} className={`flex items-center gap-3 rounded-xl px-2 py-2 text-left ${focus}`}>
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-[#f04b58]/30 bg-[#f04b58]/10 text-sm font-bold text-[#ff7882]">{user?.username?.slice(0, 2).toUpperCase() || "CF"}</span>
          <span><span className="block max-w-36 truncate text-xs font-bold">{user?.username || (session === "in" ? "Player" : "Guest player")}</span><span className="mt-1 block text-[10px] text-zinc-400">{session === "loading" ? "Checking session…" : session === "error" ? "Session unavailable" : user ? `${user.elo.toLocaleString()} Elo` : "Lobby preview"}</span></span>
          <Icon name="chevron" className="h-4 w-4 text-zinc-400" />
        </button>
        {menu && <div id="profile-options" className="absolute right-0 top-full w-56 pt-2"><div className={`${panel} p-2 text-sm`}>
          {session === "in" ? <><Link href="/profile/me" className={`block rounded-xl px-4 py-3 hover:bg-white/5 ${focus}`}>My profile</Link><button onClick={() => setDetail("Your ladder")} className={`w-full rounded-xl px-4 py-3 text-left hover:bg-white/5 ${focus}`}>My ladder</button><button disabled={loggingOut} onClick={signOut} className={`w-full rounded-xl px-4 py-3 text-left text-[#ff7882] hover:bg-white/5 disabled:opacity-50 ${focus}`}>{loggingOut ? "Signing out…" : "Sign out"}</button></> : <Link href="/login" className={`block rounded-xl px-4 py-3 hover:bg-white/5 ${focus}`}>Sign in with Google</Link>}
          {logoutError && <p role="alert" className="px-4 py-2 text-xs text-red-300">{logoutError}</p>}
        </div></div>}
      </div>
      </div>
    </header>
      <InfoDialog title={detail} onClose={() => setDetail(null)} />
    </>
  );
}
