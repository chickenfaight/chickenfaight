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

const menuItem = "block w-full rounded-control px-4 py-3 text-left transition-colors duration-(--duration-fast) hover:bg-white/[0.06] focus-ring";

export function Wordmark() {
  return <span translate="no" className="whitespace-nowrap text-xl font-extrabold tracking-[-0.04em]">chicken<span className="text-accent">fAIght.</span></span>;
}

// The sidebar owns navigation; the header holds help, search, and account actions.
export default function SiteHeader({ query }: { current?: "play" | "leaderboards"; query?: string }) {
  const { user, status: session, logout, loggingOut, logoutError } = useSession();
  const [detail, setDetail] = useState<DetailTitle | null>(null);
  const name = user?.username || user?.tag || (session === "in" ? "Player" : "Guest player");

  return (
    <>
      <header style={{ viewTransitionName: "site-header" }} className="z-20 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-line bg-canvas/75 backdrop-blur-sm px-gutter xl:h-[76px]">
        <Link href="/" className="shrink-0 rounded-control focus-ring" aria-label="chickenfAIght. home"><Wordmark /></Link>
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <button type="button" onClick={() => setDetail("How to play")} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-control text-xs font-semibold text-ink-muted transition-colors duration-(--duration-fast) hover:text-ink focus-ring"><Icon name="help" className="h-5 w-5 sm:hidden" /><span className="sr-only sm:not-sr-only">How to play</span></button>
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
