import type { ReactNode } from "react";
import PageTransition from "./page-transition";
import Sidebar from "./sidebar";

// Layout for signed-in pages: the header on top, the sidebar beside the page.
// The page always fills the window and grows with its content (never shrinks below it, so panels
// can't overlap); `scrollContent` scrolls only the page body.
// The header and sidebar hold still while the page body transitions (globals.css).
export default function AppShell({ header, children, scrollContent = false }: {
  header: ReactNode; children: ReactNode; scrollContent?: boolean;
}) {
  const height = scrollContent ? "h-svh overflow-hidden" : "";
  return (
    <div className={`flex min-h-svh flex-col bg-canvas font-sans text-ink ${height}`}>
      {header}
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className={`flex min-w-0 flex-1 flex-col ${scrollContent ? "overflow-y-auto" : ""}`}><PageTransition>{children}</PageTransition></div>
      </div>
    </div>
  );
}
