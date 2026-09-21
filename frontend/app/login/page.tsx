import type { Metadata } from "next";
import Link from "next/link";
import { backendUrl } from "../lib/auth";

export const metadata: Metadata = {
  title: "Log in · Chickenfaight",
  description: "Sign in to Chickenfaight with Google.",
};

export default function LoginPage() {
  return (
    <div className="flex min-h-svh flex-col bg-black font-sans text-white">
      <header className="flex items-center justify-between px-6 py-7 sm:px-10">
        <Link href="/" className="text-sm font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
          chickenfaight<span className="text-zinc-500">.</span>
        </Link>
        <Link href="/" className="text-xs text-zinc-400 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
          ← Back to home
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <section className="w-full max-w-[420px] rounded-3xl border border-white/10 bg-gradient-to-b from-zinc-900/70 to-zinc-950/50 px-7 py-12 sm:px-10 sm:py-14" aria-labelledby="login-heading">
          <p className="mb-3 text-[10px] font-medium tracking-[0.25em] text-zinc-500 uppercase">ChickenfAIght</p>
          <h1 id="login-heading" className="text-4xl font-medium tracking-[-0.045em]">Welcome in.</h1>
          <p className="mt-4 text-sm leading-6 text-zinc-400">Sign in with Google to continue.</p>
          <a href={`${backendUrl}/auth/google/login`} className="mt-10 flex min-h-12 w-full items-center justify-center gap-3 rounded-xl bg-white px-4 py-3 text-sm font-medium text-zinc-950 transition-colors hover:bg-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.89-1.74 2.98-4.31 2.98-7.36Z" />
              <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.97-3.38.97-2.6 0-4.81-1.76-5.6-4.12H3.06v2.59A10 10 0 0 0 12 22Z" />
              <path fill="#FBBC05" d="M6.4 13.93a6 6 0 0 1 0-3.86V7.48H3.06a10 10 0 0 0 0 9.04l3.34-2.59Z" />
              <path fill="#EA4335" d="M12 5.95c1.47 0 2.79.51 3.83 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.94 5.48l3.34 2.59A5.99 5.99 0 0 1 12 5.95Z" />
            </svg>
            Continue with Google
          </a>
          <p className="mt-5 text-center text-xs leading-5 text-zinc-500">By continuing, you agree to our terms and services.</p>
        </section>
      </main>

      <footer className="px-6 py-7 text-center text-[10px] tracking-[0.2em] text-zinc-600 uppercase">Chickenfaight</footer>
    </div>
  );
}
