"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useSession } from "./providers/session-provider";

const fieldClass = "mt-3 block min-h-12 w-full rounded-xl border border-white/10 bg-zinc-800 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";
const buttonClass = "mt-4 flex min-h-12 w-full items-center justify-center rounded-xl bg-zinc-700 px-4 py-3 text-sm font-semibold text-zinc-100 transition-colors enabled:hover:bg-zinc-600 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";

// Tag-and-password sign-in. The password goes to the backend as typed (over HTTPS in production);
// only the backend hashes it.
export default function LoginForm() {
  const controller = useRef<AbortController | null>(null);
  const router = useRouter();
  const { refresh } = useSession();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => controller.current?.abort(), []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const tag = String(formData.get("tag") ?? "");
    const password = String(formData.get("password") ?? "");
    if (!tag || !password) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setPending(true);
    setError("");
    try {
      await api("/auth/login", current.signal, "POST", { tag, password });
      // Update the app-wide session state before leaving, or the lobby would still see "out".
      if (await refresh() !== "in") throw new Error("Session not established");
      router.replace("/");
    } catch (err) {
      if (current.signal.aborted) return;
      setError(err instanceof ApiError && err.status === 401 ? "Incorrect tag or password."
        : err instanceof ApiError && err.status === 429 ? "Too many attempts. Wait a minute and try again."
        : "Couldn’t sign in. Try again.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-8">
      <label htmlFor="login-tag" className="sr-only">Tag</label>
      <input id="login-tag" className={fieldClass} name="tag" placeholder="Tag" autoComplete="username" maxLength={64} required />
      <label htmlFor="login-password" className="sr-only">Password</label>
      <input id="login-password" className={fieldClass} name="password" placeholder="Password" type="password" autoComplete="current-password" maxLength={128} required />
      <button type="submit" disabled={pending} className={buttonClass}>{pending ? "Signing in…" : "Sign in"}</button>
      <p role="alert" className="mt-2 min-h-4 text-xs text-red-300">{error}</p>
    </form>
  );
}
