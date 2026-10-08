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
  logout: () => Promise<boolean>; // true once signed out
  loggingOut: boolean;
  logoutError: string;
};

const SessionContext = createContext<Session | null>(null);

// Pages a signed-out visitor may stay on.
const PUBLIC_PATHS = ["/login", "/health"];

// The signed-in user from `/auth/me`, shared by every page.
export default function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const logoutController = useRef<AbortController | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const res = await fetch(`${backendUrl}/auth/me`, { credentials: "include", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) });
        if (res.status === 401) { setStatus("out"); return; }
        if (!res.ok) throw new Error("Session unavailable");
        setUserState(parseUser(await res.json())); setStatus("in");
      } catch { if (!controller.signal.aborted) setStatus("error"); }
    }
    void load();
    return () => { controller.abort(); logoutController.current?.abort(); };
  }, []);

  // No valid session (expired, invalid, or just logged out): send the visitor to log in.
  useEffect(() => {
    if (status === "out" && !PUBLIC_PATHS.includes(pathname)) { router.replace("/login"); setStatus("loading"); }
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
    () => ({ user, status, setUser, logout, loggingOut, logoutError }),
    [user, status, setUser, logout, loggingOut, logoutError],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside SessionProvider");
  return session;
}
