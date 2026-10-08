"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Icon from "./line-icon";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";

const SECTIONS = [
  { href: "/", label: "Play", icon: "play", matches: (path: string) => path === "/" },
  { href: "/challenge", label: "Daily challenge", icon: "bolt", matches: (path: string) => path.startsWith("/challenge") },
  { href: "/tips", label: "Debate tips", icon: "chat", matches: (path: string) => path.startsWith("/tips") },
  { href: "/profile/me", label: "Profile", icon: "user", matches: (path: string) => path.startsWith("/profile") },
  { href: "/settings", label: "Settings", icon: "gear", matches: (path: string) => path.startsWith("/settings") },
] as const;

// Page navigation for signed-in pages; labels collapse to icons on narrow screens.
export default function Sidebar() {
  const pathname = usePathname();
  return (
    <nav aria-label="Sections" className="shrink-0 border-r border-white/[0.07] px-3 py-5 lg:w-56 lg:px-4">
      <ul className="flex flex-col gap-1">
        {SECTIONS.map((section) => {
          const current = section.matches(pathname);
          return <li key={section.href}>
            <Link href={section.href} aria-current={current ? "page" : undefined} title={section.label}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${current ? "bg-[#f04b58]/10 text-[#ff7882]" : "text-zinc-400 hover:bg-white/5 hover:text-white"} ${focus}`}>
              <Icon name={section.icon} className="h-5 w-5 shrink-0" />
              <span className="sr-only lg:not-sr-only">{section.label}</span>
            </Link>
          </li>;
        })}
      </ul>
    </nav>
  );
}
