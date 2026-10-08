"use client";

import { SubmitEvent, useRef } from "react";
import { api, ApiError } from "../lib/api";
import { useRouter } from "next/navigation";

const fieldClass = "mt-8 flex min-h-12 w-full items-center justify-center gap-3 rounded-xl bg-zinc-800 px-4 py-3 text-sm font-semibold text-zinc-100 transition-colors hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";

export default function LoginForm() {
  const controller = useRef<AbortController | null>(null);
  const router = useRouter();

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    const formData = new FormData(event.currentTarget);
    if (!formData.get("username") || !formData.get("password")) return;
    // TODO: Password hashing (SHA-256)
    try {
      await api("/auth/login", current.signal, "POST", { "username": formData.get("username"), "password_hash": formData.get("password") });
      router.replace("/");
    } catch (err) {
      if (current.signal.aborted) return;
      console.log(err);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <input className={fieldClass} name="username" placeholder="Username" />
      <input className={fieldClass} name="password" placeholder="Password" type="password" />
      <button type="submit" className={fieldClass}>
        Sign In
      </button>
    </form>
  );
}

