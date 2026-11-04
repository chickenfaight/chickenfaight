import type { ReactNode } from "react";
import Sidebar from "./sidebar";

// Layout for signed-in pages: the header on top, the sidebar beside the page.
// `fill` gives the lobby a minimum desktop height; `scrollContent` scrolls only the page body.
export default function AppShell({ header, children, fill = false, scrollContent = false }: {
  header: ReactNode; children: ReactNode; fill?: boolean; scrollContent?: boolean;
}) {
  const height = scrollContent ? "h-svh overflow-hidden" : fill ? "min-[1024px]:h-svh min-[1024px]:min-h-[800px]" : "";
  return (
    <div className={`flex min-h-svh flex-col bg-[#17181b] font-sans text-[#f5f3ef] ${height}`}>
      {header}
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className={`flex min-w-0 flex-1 flex-col ${scrollContent ? "overflow-y-auto" : ""}`}>{children}</div>
      </div>
    </div>
  );
}
