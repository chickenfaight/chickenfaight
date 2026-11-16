"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { buttonClass } from "./button";
import { useSession } from "./providers/session-provider";

const fieldClass = "mt-3 block min-h-12 w-full rounded-control border border-line-strong bg-inset px-4 py-3 text-sm text-ink placeholder:text-ink-faint transition-colors duration-(--duration-fast) hover:border-ink-faint aria-invalid:border-danger/60 focus-ring";

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
    <form
      // Without this, a form submitted before the page's JavaScript loads puts the password in the URL.
      method="post"
      onSubmit={onSubmit} className="mt-8">
      <label htmlFor="login-tag" className="sr-only">Tag</label>
      <input id="login-tag" className={fieldClass} name="tag" placeholder="Tag" autoComplete="username" maxLength={64} required />
      <label htmlFor="login-password" className="sr-only">Password</label>
      <input id="login-password" className={fieldClass} name="password" placeholder="Password" type="password" autoComplete="current-password" maxLength={128} required />
      <button type="submit" disabled={pending} className={buttonClass("primary", "lg", "mt-4 w-full")}>{pending ? "Signing in…" : "Sign in"}</button>
      <p role="alert" className="mt-2 min-h-4 text-xs text-danger">{error}</p>
    </form>
  );
}
