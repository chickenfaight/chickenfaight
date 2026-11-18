"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { profileHref } from "../lib/routes";
import Icon, { type IconName } from "./line-icon";
import { useFriendRequests } from "./providers/friend-requests-provider";
import { useSession } from "./providers/session-provider";

const PROFILE_ALIAS = "/profile/me";

const SECTIONS: { href: string; label: string; icon: IconName; matches: (path: string) => boolean }[] = [
  { href: "/", label: "Play", icon: "play", matches: (path: string) => path === "/" },
  { href: "/challenge", label: "Daily challenge", icon: "bolt", matches: (path: string) => path.startsWith("/challenge") },
  { href: "/leaderboards", label: "Leaderboards", icon: "trophy", matches: (path: string) => path === "/leaderboards" },
  { href: "/tips", label: "Debate tips", icon: "chat", matches: (path: string) => path.startsWith("/tips") },
  { href: "/bilc", label: "BILC", icon: "chip", matches: (path: string) => path.startsWith("/bilc") },
  { href: "/matches", label: "Debate history", icon: "history", matches: (path: string) => path.startsWith("/matches") },
  { href: PROFILE_ALIAS, label: "Profile", icon: "user", matches: (path: string) => path.startsWith("/profile") },
  { href: "/settings", label: "Settings", icon: "gear", matches: (path: string) => path.startsWith("/settings") },
];

// Only for tags the backend lists as admins; the page itself is gated by the backend.
const ADMIN_SECTION = { href: "/admin/topics", label: "Admin", icon: "shield", matches: (path: string) => path.startsWith("/admin") } as const;

// Page navigation for signed-in pages; labels collapse to icons on narrow screens.
export default function Sidebar() {
  const [expanded, setExpanded] = useState(false);
  const pathname = usePathname();
  const { count } = useFriendRequests();
  const { user } = useSession();
  const sections = user?.is_admin ? [...SECTIONS, ADMIN_SECTION] : SECTIONS;
  const navigation = (
    <nav aria-label="Sections" style={{ viewTransitionName: "site-sidebar" }} className="min-h-0 shrink-0 overflow-y-auto border-r border-line px-2.5 py-5 lg:w-56 lg:px-4">
      <ul className="flex flex-col gap-1">
        {sections.map((section) => {
          const current = section.matches(pathname);
          const profile = section.href === PROFILE_ALIAS;
          const href = profile && user?.tag ? profileHref(user.tag) : section.href;
          const waiting = profile ? count : 0;
          const waitingLabel = `${waiting} friend ${waiting === 1 ? "request" : "requests"}`;
          return <li key={section.href} className={section.href === "/matches" ? "mt-4 border-t border-line pt-4" : undefined}>
            <Link href={href} aria-current={current ? "page" : undefined} title={waiting ? `${section.label}: ${waitingLabel}` : section.label}
              className={`relative flex items-center gap-3 rounded-control px-3 py-2.5 text-sm font-semibold transition-[color,background-color,transform] duration-(--duration-fast) focus-ring active:scale-[0.98] ${current ? "bg-accent-wash text-accent-ink" : "text-ink-muted hover:bg-white/[0.05] hover:text-ink"}`}>
              <Icon name={section.icon} className="h-5 w-5 shrink-0" />
              <span className="rail-label">{section.label}</span>
              {waiting > 0 && <>
                <span aria-hidden="true" className="absolute right-0.5 top-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold tabular-nums text-white shadow-button lg:static lg:ml-auto lg:h-5 lg:min-w-5 lg:text-[11px]">{waiting > 99 ? "99+" : waiting}</span>
                <span className="sr-only">, {waitingLabel}</span>
              </>}
            </Link>
          </li>;
        })}
      </ul>
    </nav>
  );
  return <div className="site-rail" data-expanded={expanded}
    onPointerEnter={event => { if (event.pointerType === "mouse") setExpanded(true); }}
    onPointerLeave={event => { if (event.pointerType === "mouse") setExpanded(false); }}
    onFocus={event => { if (event.target.matches(":focus-visible")) setExpanded(true); }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false); }}
    onKeyDown={event => {
    if (event.key === "Escape" && expanded) {
      setExpanded(false);
    }
  }}>{navigation}</div>;
}
