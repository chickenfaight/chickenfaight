"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { backendUrl } from "../../lib/auth";
import { parseUser, type User } from "../../lib/protocol";

export type SessionStatus = "loading" | "in" | "out" | "error";

type Session = {
  user: User | null;
  status: SessionStatus;
  setUser: (user: User) => void;
  refresh: () => Promise<SessionStatus>; // re-checks `/auth/me`, e.g. after signing in
  logout: () => Promise<boolean>; // true once signed out
  loggingOut: boolean;
  logoutError: string;
};

const SessionContext = createContext<Session | null>(null);

// Pages a signed-out visitor may stay on.
const PUBLIC_PATHS = ["/login", "/signup", "/health"];

// The signed-in user from `/auth/me`, shared by every page.
export default function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const logoutController = useRef<AbortController | null>(null);
  const loadController = useRef<AbortController | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  // Asks the backend whether the session cookie is valid; the client never decides on its own.
  const refresh = useCallback(async (): Promise<SessionStatus> => {
    loadController.current?.abort();
    const controller = new AbortController(); loadController.current = controller;
    let next: SessionStatus;
    try {
      const res = await fetch(`${backendUrl}/auth/me`, { credentials: "include", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) });
      if (res.status === 401) { setUserState(null); next = "out"; }
      else if (!res.ok) throw new Error("Session unavailable");
      else { setUserState(parseUser(await res.json())); next = "in"; }
    } catch { next = "error"; }
    if (!controller.signal.aborted) setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    async function load() { await refresh(); }
    void load();
    return () => { loadController.current?.abort(); logoutController.current?.abort(); };
  }, [refresh]);

  // No valid session (expired, invalid, or just logged out): send the visitor to log in.
  useEffect(() => {
    if (status === "out" && !PUBLIC_PATHS.includes(pathname)) router.replace("/login");
  }, [status, pathname, router]);

  const setUser = useCallback((next: User) => { setUserState(next); setStatus("in"); }, []);

  const logout = useCallback(async () => {
    setLoggingOut(true); setLogoutError("");
    const controller = new AbortController(); logoutController.current = controller;
    try {
      const res = await fetch(`${backendUrl}/auth/logout`, { method: "POST", credentials: "include", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) });
      if (!res.ok) throw new Error("Logout failed");
      setUserState(null); setStatus("out");
      return true;
    } catch { if (!controller.signal.aborted) setLogoutError("Couldn’t sign out. Try again."); return false; }
    finally { if (!controller.signal.aborted) setLoggingOut(false); }
  }, []);

  const value = useMemo(
    () => ({ user, status, setUser, refresh, logout, loggingOut, logoutError }),
    [user, status, setUser, refresh, logout, loggingOut, logoutError],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside SessionProvider");
  return session;
}
