import { ViewTransition, type ReactNode } from "react";

// Page changes animate through the View Transitions API: navigations are transitions, so this
// boundary exits with the old page and enters with the new one (`.page` in globals.css: opacity and
// transform only). Other updates on the page don't animate it. Browsers without the API just swap.
export default function PageTransition({ children }: { children: ReactNode }) {
  return <ViewTransition enter="page" exit="page" default="none">{children}</ViewTransition>;
}
