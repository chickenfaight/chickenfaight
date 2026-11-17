import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "./site-header";

// Shared shell for /login and /signup: header, the game's pitch, and a card holding the form.
export default function AuthLayout({ eyebrow, heading, intro, children }: { eyebrow: string; heading: string; intro: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-canvas font-sans text-ink">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-line px-gutter xl:h-[76px]">
        <Link href="/" aria-label="chickenfAIght. home" className="rounded-control focus-ring"><Wordmark /></Link>
        <Link href="/" className="rounded-control text-xs font-medium text-ink-muted transition-colors duration-(--duration-fast) hover:text-ink focus-ring">← Back to the lobby</Link>
      </header>
      <main className="mx-auto flex w-full max-w-[1120px] flex-1 items-center px-gutter py-10">
        <div className="grid w-full items-center gap-12 md:grid-cols-[1.1fr_1fr] lg:gap-20">
          <section aria-labelledby="arena-heading" className="animate-rise">
            <p className="eyebrow mb-5 text-accent-ink">The debate arena</p>
            <h1 id="arena-heading" className="headline text-7xl leading-[0.92]">Small prompt.<br /><span className="text-accent">Big fight.</span></h1>
            <p className="mt-6 max-w-sm text-sm leading-7 text-ink-muted">Your words. Your strategy. Your AI.<br />Take a side and give your model something worth arguing about.</p>
            <ol className="mt-9 space-y-5">
              {[
                ["Write your prompt", "Give your AI its debating strategy."],
                ["Watch the feathers fly", "Two AIs. Opposing sides. One debate."],
                ["Let the judge decide", "An AI judge picks the winning argument."],
              ].map(([title, description], index) => (
                <li key={title} className="flex items-center gap-4"><span className="stat flex h-10 w-10 shrink-0 items-center justify-center rounded-control border border-line bg-surface text-lg text-accent-ink">0{index + 1}</span><div><p className="text-sm font-semibold">{title}</p><p className="mt-0.5 text-xs text-ink-faint">{description}</p></div></li>
              ))}
            </ol>
          </section>
          <section aria-labelledby="auth-heading" className="panel p-panel animate-rise [animation-delay:80ms] lg:p-10">
            <p className="eyebrow text-accent-ink">{eyebrow}</p>
            <h2 id="auth-heading" className="mt-3 text-3xl font-bold tracking-tight">{heading}</h2>
            <p className="mt-3 text-sm leading-6 text-ink-muted">{intro}</p>
            {children}
            <div className="eyebrow mt-8 border-t border-line pt-5 text-center">One prompt. Two sides. One winner.</div>
          </section>
        </div>
      </main>
      <footer className="flex shrink-0 items-center justify-between gap-4 px-gutter py-5 text-xs text-ink-faint"><span>All brains. A little bit of bird.</span><span>Chicken fAIght <span className="mx-2 text-line-strong">/</span> Made for a good argument.</span></footer>
    </div>
  );
}
