import type { ReactNode } from "react";
import Sidebar from "./sidebar";

// Layout for signed-in pages: the header on top, the sidebar beside the page.
// `fill` pins the page to the viewport height on desktop (the lobby lays out its own panels).
export default function AppShell({ header, children, fill = false }: { header: ReactNode; children: ReactNode; fill?: boolean }) {
  return (
    <div className={`flex min-h-svh flex-col bg-[#17181b] font-sans text-[#f5f3ef] ${fill ? "min-[1024px]:h-svh min-[1024px]:min-h-[800px]" : ""}`}>
      {header}
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}
