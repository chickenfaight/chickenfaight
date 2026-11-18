"use client";

import Link from "next/link";
import { useState } from "react";
import { profileHref } from "../lib/routes";
import Avatar from "./avatar";
import Icon from "./line-icon";
import InfoDialog, { type DetailTitle } from "./info-dialog";
import PopoverMenu from "./popover-menu";
import { useSession } from "./providers/session-provider";
import { MobileNavigation } from "./sidebar";
import UserSearch from "./user-search";

const menuItem = "block w-full rounded-control px-4 py-3 text-left transition-colors duration-(--duration-fast) hover:bg-white/[0.06] focus-ring";

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return <span translate="no" className={`whitespace-nowrap font-extrabold tracking-[-0.04em] ${compact ? "text-lg max-[359px]:text-base sm:text-xl" : "text-xl"}`}>chicken<span className="text-accent">fAIght.</span></span>;
}

// The sidebar owns navigation; the header holds help, search, and account actions.
export default function SiteHeader({ query }: { current?: "play" | "leaderboards"; query?: string }) {
  const { user, status: session, logout, loggingOut, logoutError } = useSession();
  const [detail, setDetail] = useState<DetailTitle | null>(null);
  const name = user?.username || user?.tag || (session === "in" ? "Player" : "Guest player");

  return (
    <>
      <header style={{ viewTransitionName: "site-header" }} className="relative z-20 flex h-16 shrink-0 items-center justify-between gap-2 border-b border-line bg-canvas/75 px-gutter backdrop-blur-sm max-[359px]:px-3 xl:h-[76px]">
        <Link href="/" className="shrink-0 rounded-control focus-ring" aria-label="chickenfAIght. home"><Wordmark compact /></Link>
        <div className="flex items-center gap-1 sm:gap-4">
          <button type="button" onClick={() => setDetail("How to play")} className="hidden min-h-11 shrink-0 items-center rounded-control px-2 text-sm font-semibold text-ink-muted transition-colors duration-(--duration-fast) hover:text-ink focus-ring lg:flex">How to play</button>
          <MobileNavigation onHelp={() => setDetail("How to play")} />
          <UserSearch key={query} initialQuery={query} />
          <PopoverMenu label="Profile options" buttonClassName="flex h-11 min-w-11 items-center justify-center rounded-control text-left transition-colors duration-(--duration-fast) hover:bg-white/[0.04] focus-ring lg:h-auto lg:gap-3 lg:px-2 lg:py-2"
            button={<>
              <Avatar name={name} url={user?.avatar_url ?? null} size={36} />
              <span className="max-[1100px]:sr-only"><span className="block max-w-36 truncate text-xs font-bold">{name}</span>{!user && <span className="mt-1 block text-xs text-ink-muted">{session === "loading" ? "Checking session…" : session === "error" ? "Session unavailable" : "Lobby preview"}</span>}</span>
              <Icon name="chevron" className="hidden h-4 w-4 text-ink-muted lg:block" />
            </>}>
            {session === "in"
              ? <>
                  <Link href={user?.tag ? profileHref(user.tag) : "/profile/me"} className={menuItem}>My profile</Link>
                  <Link href="/settings" className={menuItem}>Settings</Link>
                  <button type="button" aria-disabled={loggingOut} onClick={() => { if (!loggingOut) void logout(); }} className={`${menuItem} text-accent-ink aria-disabled:opacity-50`}>{loggingOut ? "Signing out…" : "Sign out"}</button>
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
