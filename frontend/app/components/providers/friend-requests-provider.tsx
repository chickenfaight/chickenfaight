"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import { parseUserPage } from "../../lib/protocol";
import { useSession } from "./session-provider";

const POLL_MS = 30000;
// The route's largest page; the sidebar shows anything above 99 as "99+".
const COUNTED = 100;

type FriendRequests = {
  count: number; // friend requests waiting for the signed-in player
  refresh: () => Promise<void>; // re-counts now, e.g. after answering one
};

const FriendRequestsContext = createContext<FriendRequests | null>(null);

// How many friend requests are waiting, shared by the sidebar and whatever answers them.
export default function FriendRequestsProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const [count, setCount] = useState(0);
  const latest = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    latest.current?.abort();
    const controller = new AbortController();
    latest.current = controller;
    try {
      const page = parseUserPage(await api(`/v1/friends/requests?direction=incoming&limit=${COUNTED}`, controller.signal));
      if (!controller.signal.aborted) setCount(page.items.length);
    } catch {
      // Keep the last count; the next poll tries again.
    }
  }, []);

  useEffect(() => {
    if (status !== "in") return;
    const visibleRefresh = () => { if (document.visibilityState === "visible") void refresh(); };
    let timer = setTimeout(function tick() {
      visibleRefresh();
      timer = setTimeout(tick, POLL_MS);
    }, 0);
    document.addEventListener("visibilitychange", visibleRefresh);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibleRefresh);
      latest.current?.abort();
    };
  }, [status, refresh]);

  const value = useMemo(() => ({ count: status === "in" ? count : 0, refresh }), [status, count, refresh]);
  return <FriendRequestsContext.Provider value={value}>{children}</FriendRequestsContext.Provider>;
}

export function useFriendRequests(): FriendRequests {
  const value = useContext(FriendRequestsContext);
  if (!value) throw new Error("useFriendRequests must be used inside FriendRequestsProvider");
  return value;
}
