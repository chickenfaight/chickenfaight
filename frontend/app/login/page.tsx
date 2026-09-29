import type { Metadata } from "next";
import Link from "next/link";
import { backendUrl } from "../lib/auth";

export const metadata: Metadata = {
  title: "Log in · Chickenfaight",
  description: "Sign in to Chickenfaight with Google.",
};

export default function LoginPage() {
  return (
    <div className="flex min-h-svh flex-col bg-[#17181b] font-sans text-[#f5f3ef]">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/[0.07] px-6 xl:h-[76px] xl:px-10">
        <Link href="/" aria-label="Chicken fAIght home" className="rounded-xl text-xl font-extrabold tracking-[-0.06em] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">chicken<span className="text-[#f04b58]">fAIght.</span></Link>
        <Link href="/" className="rounded-xl text-xs font-medium text-zinc-400 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">← Back to the lobby</Link>
      </header>
      <main className="mx-auto flex w-full max-w-[1120px] flex-1 items-center px-8 py-10 xl:px-10">
        <div className="grid w-full items-center gap-12 md:grid-cols-[1.1fr_1fr] lg:gap-20">
          <section aria-labelledby="arena-heading">
            <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#f04b58]/20 bg-[#f04b58]/[0.07] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#ff7882]"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />The debate arena</p>
            <h1 id="arena-heading" className="text-[clamp(44px,5vw,68px)] font-black leading-[1.02] tracking-[-0.065em]">Small prompt.<br /><span className="text-[#f04b58]">Big fight.</span></h1>
            <p className="mt-6 max-w-sm text-sm leading-7 text-zinc-400">Your words. Your strategy. Your AI.<br />Take a side and give your model something worth arguing about.</p>
            <ol className="mt-9 space-y-5">
              {[
                ["Write your prompt", "Give your AI its debating strategy."],
                ["Watch the feathers fly", "Two AIs. Opposing sides. One debate."],
                ["Let the judge decide", "An AI judge picks the winning argument."],
              ].map(([title, description], index) => (
                <li key={title} className="flex items-center gap-4"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.07] bg-[#202124] font-mono text-xs text-[#ff7882]">0{index + 1}</span><div><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-xs text-zinc-500">{description}</p></div></li>
              ))}
            </ol>
          </section>
          <section aria-labelledby="login-heading" className="relative overflow-hidden rounded-3xl border border-white/[0.07] bg-[#202124] p-8 lg:p-10">
            <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full border-[40px] border-[#f04b58]/[0.04]" />
            <div className="relative">
              <span aria-hidden="true" className="mb-7 flex h-12 w-12 items-center justify-center rounded-xl border border-[#f04b58]/20 bg-[#f04b58]/10 text-[#ff7882]"><svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m13 2-9 12h7l-1 8L20 9h-7l1-7Z" /></svg></span>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#ff7882]">A seat in the arena</p>
              <h2 id="login-heading" className="mt-3 text-3xl font-bold tracking-[-0.045em]">Welcome to the coop.</h2>
              <p className="mt-4 text-sm leading-6 text-zinc-400">Sign in to find your next opponent.<br />Your best argument starts here.</p>
              <a href={`${backendUrl}/auth/google/login`} className="mt-8 flex min-h-12 w-full items-center justify-center gap-3 rounded-xl bg-[#f5f3ef] px-4 py-3 text-sm font-semibold text-zinc-950 transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.89-1.74 2.98-4.31 2.98-7.36Z" />
              <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.97-3.38.97-2.6 0-4.81-1.76-5.6-4.12H3.06v2.59A10 10 0 0 0 12 22Z" />
              <path fill="#FBBC05" d="M6.4 13.93a6 6 0 0 1 0-3.86V7.48H3.06a10 10 0 0 0 0 9.04l3.34-2.59Z" />
              <path fill="#EA4335" d="M12 5.95c1.47 0 2.79.51 3.83 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.94 5.48l3.34 2.59A5.99 5.99 0 0 1 12 5.95Z" />
            </svg>
                Continue with Google
              </a>
              <p className="mt-4 text-center text-[11px] leading-5 text-zinc-500">New here? The same button gets you started.</p>
              <div className="mt-8 border-t border-white/[0.07] pt-5 text-center text-[10px] font-medium uppercase tracking-widest text-zinc-500">One prompt. Two sides. One winner.</div>
            </div>
          </section>
        </div>
      </main>
      <footer className="flex shrink-0 items-center justify-between gap-4 px-6 py-5 text-[10px] text-zinc-500 xl:px-10"><span>All brains. A little bit of bird.</span><span>Chicken fAIght <span className="mx-2 text-zinc-700">/</span> Made for a good argument.</span></footer>
    </div>
  );
}
