"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";

function DestinationFocus() {
  const pathname = usePathname();
  const search = useSearchParams();
  const destination = pathname === "/search" ? `${pathname}?${search.get("q") ?? ""}` : pathname;
  const previous = useRef(destination);

  useEffect(() => {
    if (previous.current === destination) return;
    previous.current = destination;
    const frame = requestAnimationFrame(() => {
      document.getElementById("main-content")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [destination]);

  return null;
}

export default function NavigationFocus() {
  return <Suspense fallback={null}><DestinationFocus /></Suspense>;
}
