"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { profileHref } from "../lib/routes";
import Icon, { type IconName } from "./line-icon";
import PopoverMenu from "./popover-menu";
import { useFriendRequests } from "./providers/friend-requests-provider";
import { useSession } from "./providers/session-provider";

const PROFILE_ALIAS = "/profile/me";

const SECTIONS: { href: string; label: string; icon: IconName; matches: (path: string) => boolean }[] = [
  { href: "/", label: "Play", icon: "play", matches: (path: string) => path === "/" },
  { href: "/challenge", label: "Daily challenge", icon: "bolt", matches: (path: string) => path.startsWith("/challenge") },
  { href: "/leaderboards", label: "Leaderboards", icon: "trophy", matches: (path: string) => path === "/leaderboards" },
  { href: "/tips", label: "Debate tips", icon: "chat", matches: (path: string) => path.startsWith("/tips") },
  { href: "/bilc", label: "Local models", icon: "chip", matches: (path: string) => path.startsWith("/bilc") },
  { href: "/matches", label: "Debate history", icon: "history", matches: (path: string) => path.startsWith("/matches") },
  { href: PROFILE_ALIAS, label: "Profile", icon: "user", matches: (path: string) => path === PROFILE_ALIAS },
  { href: "/settings", label: "Settings", icon: "gear", matches: (path: string) => path.startsWith("/settings") },
];

// Only for tags the backend lists as admins; the page itself is gated by the backend.
const ADMIN_SECTION = { href: "/admin/topics", label: "Admin", icon: "shield", matches: (path: string) => path.startsWith("/admin") } as const;

function NavigationLinks() {
  const pathname = usePathname();
  const { count } = useFriendRequests();
  const { user } = useSession();
  const sections = user?.is_admin ? [...SECTIONS, ADMIN_SECTION] : SECTIONS;

  return <ul className="grid gap-1">
    {sections.map((section) => {
      const profile = section.href === PROFILE_ALIAS;
      const href = profile && user?.tag ? profileHref(user.tag) : section.href;
      const current = pathname === href || section.matches(pathname);
      const waiting = profile ? count : 0;
      return <li key={section.href} className={section.href === "/matches" ? "mt-2 border-t border-line pt-2" : undefined}>
        <Link href={href} aria-current={current ? "page" : undefined}
          className={`flex min-h-11 items-center gap-3 rounded-control px-3 py-2 text-sm font-semibold transition-colors duration-(--duration-fast) focus-ring ${current ? "bg-accent-wash text-accent-ink" : "text-ink-muted hover:bg-white/[0.05] hover:text-ink"}`}>
          <Icon name={section.icon} className="h-5 w-5 shrink-0" />
          <span>{section.label}</span>
          {waiting > 0 && <>
            <span aria-hidden="true" className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-xs font-bold tabular-nums text-white">{waiting > 99 ? "99+" : waiting}</span>
            <span className="sr-only">, {waiting} friend {waiting === 1 ? "request" : "requests"}</span>
          </>}
        </Link>
      </li>;
    })}
  </ul>;
}

export default function Sidebar() {
  return <nav aria-label="Sections" style={{ viewTransitionName: "site-sidebar" }} className="hidden min-h-0 w-52 shrink-0 overflow-y-auto border-r border-line bg-canvas px-3 py-5 lg:block xl:w-56 xl:px-4">
    <NavigationLinks />
  </nav>;
}

export function MobileNavigation({ onHelp }: { onHelp: () => void }) {
  const pathname = usePathname();
  const { count } = useFriendRequests();

  return <div className="lg:hidden">
    <PopoverMenu key={pathname} label="Site menu" openOnHover={false} closeOnAction
      buttonClassName="relative min-h-11 min-w-11 rounded-control px-2 text-sm font-semibold text-ink-muted hover:bg-white/[0.05] hover:text-ink focus-ring"
      button={<>Menu{count > 0 && <>
        <span aria-hidden="true" className="absolute right-0 top-0 rounded-full bg-accent px-1 text-xs font-bold tabular-nums text-white">{count > 99 ? "99+" : count}</span>
        <span className="sr-only">, {count} friend {count === 1 ? "request" : "requests"}</span>
      </>}</>}>
      <nav aria-label="Sections"><NavigationLinks /></nav>
      <div className="mt-2 border-t border-line pt-2">
        <button type="button" onClick={onHelp} className="flex min-h-11 w-full items-center gap-3 rounded-control px-3 text-left text-sm font-semibold text-ink-muted hover:bg-white/[0.05] hover:text-ink focus-ring">
          <Icon name="help" className="h-5 w-5 shrink-0" />How to play
        </button>
      </div>
    </PopoverMenu>
  </div>;
}
