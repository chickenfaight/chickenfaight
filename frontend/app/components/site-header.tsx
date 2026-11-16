"use client";

import Link from "next/link";
import { useState } from "react";
import { profileHref } from "../lib/routes";
import Avatar from "./avatar";
import Icon from "./line-icon";
import InfoDialog, { type DetailTitle } from "./info-dialog";
import PopoverMenu from "./popover-menu";
import { useSession } from "./providers/session-provider";
import UserSearch from "./user-search";

const navLink = (active: boolean) => `flex h-full items-center border-b-2 transition-colors duration-(--duration-fast) focus-ring ${active ? "border-accent text-ink" : "border-transparent text-ink-muted hover:text-ink"}`;
const menuItem = "block w-full rounded-control px-4 py-3 text-left transition-colors duration-(--duration-fast) hover:bg-white/[0.06] focus-ring";

export function Wordmark() {
  return <span className="text-xl font-extrabold tracking-[-0.06em]">chicken<span className="text-accent">fAIght.</span></span>;
}

// The app's top bar: wordmark, navigation, player search, and the profile menu.
export default function SiteHeader({ current, query }: { current?: "play" | "leaderboards"; query?: string }) {
  const { user, status: session, logout, loggingOut, logoutError } = useSession();
  const [detail, setDetail] = useState<DetailTitle | null>(null);
  const name = user?.username || user?.tag || (session === "in" ? "Player" : "Guest player");

  return (
    <>
      <header style={{ viewTransitionName: "site-header" }} className="z-20 flex h-16 shrink-0 items-center justify-between gap-6 border-b border-line bg-canvas px-gutter xl:h-[76px]">
        <Link href="/" className="rounded-control focus-ring" aria-label="Chicken fAIght home"><Wordmark /></Link>
        <nav aria-label="Main navigation" className="flex h-full items-center gap-8 text-sm font-semibold max-[900px]:hidden">
          <Link href="/" aria-current={current === "play" ? "page" : undefined} className={navLink(current === "play")}>Play</Link>
          <Link href="/leaderboards" aria-current={current === "leaderboards" ? "page" : undefined} className={navLink(current === "leaderboards")}>Leaderboards</Link>
          <button type="button" onClick={() => setDetail("How to play")} className="text-ink-muted transition-colors duration-(--duration-fast) hover:text-ink focus-ring">How to play</button>
        </nav>
        <div className="flex items-center gap-4">
          <div className="max-[640px]:hidden"><UserSearch key={query} initialQuery={query} /></div>
          <PopoverMenu label="Profile options" buttonClassName="flex items-center gap-3 rounded-control px-2 py-2 text-left transition-colors duration-(--duration-fast) hover:bg-white/[0.04] focus-ring"
            button={<>
              <Avatar name={name} url={user?.avatar_url ?? null} size={40} />
              <span className="max-[1100px]:sr-only"><span className="block max-w-36 truncate text-xs font-bold">{name}</span>{!user && <span className="mt-1 block text-xs text-ink-muted">{session === "loading" ? "Checking session…" : session === "error" ? "Session unavailable" : "Lobby preview"}</span>}</span>
              <Icon name="chevron" className="h-4 w-4 text-ink-muted" />
            </>}>
            {session === "in"
              ? <>
                  <Link href={user?.tag ? profileHref(user.tag) : "/profile/me"} className={menuItem}>My profile</Link>
                  <button type="button" disabled={loggingOut} onClick={() => void logout()} className={`${menuItem} text-accent-ink disabled:opacity-50`}>{loggingOut ? "Signing out…" : "Sign out"}</button>
                </>
              : <Link href="/login" className={menuItem}>Sign in</Link>}
            {logoutError && <p role="alert" className="px-4 py-2 text-xs text-danger">{logoutError}</p>}
          </PopoverMenu>
        </div>
      </header>
      <InfoDialog title={detail} onClose={() => setDetail(null)} />
    </>
  );
}
