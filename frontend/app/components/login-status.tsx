"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { backendUrl } from "../lib/auth";

export default function LoginStatus() {
  const [status, setStatus] = useState<"loading" | "in" | "out" | "error">("loading");

  useEffect(() => {
    const controller = new AbortController();
    async function checkSession() {
      try {
        const response = await fetch(`${backendUrl}/auth/me`, {
          credentials: "include",
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
        });
        if (!controller.signal.aborted) {
          setStatus(response.ok ? "in" : response.status === 401 ? "out" : "error");
        }
      } catch {
        if (!controller.signal.aborted) setStatus("error");
      }
    }
    void checkSession();
    return () => controller.abort();
  }, []);

  return (
    <div className="flex min-h-10 items-center gap-4 text-sm" aria-live="polite">
      {status === "loading" && <span className="text-zinc-500">Checking session…</span>}
      {status === "in" && <span className="text-zinc-400">Signed in</span>}
      {status === "error" && <span className="text-zinc-500">Unable to check session</span>}
      {(status === "out" || status === "error") && (
        <Link href="/login" className="rounded-full border border-white/20 px-5 py-2.5 text-white transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
          Log in
        </Link>
      )}
    </div>
  );
}
