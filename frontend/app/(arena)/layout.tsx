import type { ReactNode } from "react";
import AppShell from "../components/app-shell";
import SiteHeader from "../components/site-header";

export default function ArenaLayout({ children }: { children: ReactNode }) {
  return <AppShell header={<SiteHeader />} backdrop={
    <div className="stage-scenery" aria-hidden="true"><div className="stage-lights" /></div>
  }>{children}</AppShell>;
}
