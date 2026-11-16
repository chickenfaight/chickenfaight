"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { eloChangeColor, otherSide, SIDE_LABEL, SIDE_TEXT, signed } from "../lib/matches";
import { displayName, type ArenaResult, type Side } from "../lib/protocol";
import Button, { buttonClass } from "./button";
import CountUp from "./count-up";
import FaceOff, { type FaceOffPlayer } from "./face-off";
import Modal from "./modal";
import PageTransition from "./page-transition";
import { useMatch } from "./providers/match-provider";
import { useSession } from "./providers/session-provider";
import { Wordmark } from "./site-header";

// Staged verdict reveal: each step's delay in ms (CSS animation delays, so the content is in the page
// at once for assistive tech and tests; reduced motion shows it all immediately).
const REVEAL = { verdict: 0, headline: 220, badge: 620, elo: 820, reason: 1150, arguments: 1400 };
const at = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

function Countdown({ deadline }: { deadline: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  const seconds = deadline ? Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000)) : null;
  const urgent = seconds !== null && seconds <= 15;
  return <div className="text-right"><p className="eyebrow">Time to submit</p><p className={`stat mt-1.5 text-5xl transition-colors duration-(--duration-slow) ${urgent ? "text-accent-ink" : ""}`} role="timer" aria-label="Time remaining to submit">{seconds === null ? "—" : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`}</p></div>;
}

function Waiting({ judging }: { judging: boolean }) {
  return <div role="status" className="panel mt-8 flex items-center gap-6 px-panel py-5 animate-rise">
    <span aria-hidden="true" className="h-9 w-9 shrink-0 rounded-full border-[3px] border-accent/20 border-t-accent motion-safe:animate-spin" />
    <div><p className="text-base font-semibold">{judging ? "Waiting for the verdict…" : "Waiting for your opponent…"}</p><p className="mt-1 text-sm text-ink-muted">{judging ? "The judge is reviewing both arguments. Sit tight." : "Your argument is ready. Sit tight."}</p></div>
  </div>;
}

// "Match found": both players slide in and face off over the topic, then the overlay fades away to the
// prompt editor already waiting underneath. Never blocks input (pointer-events-none), and CSS-only,
// so it ends on its own; the same information stays on the page.
function MatchIntro({ you, opponent, topic, onDone }: { you: FaceOffPlayer; opponent: FaceOffPlayer; topic: string; onDone: () => void }) {
  return <div aria-hidden="true" onAnimationEnd={(event) => { if (event.target === event.currentTarget) onDone(); }}
    className="pointer-events-none fixed inset-0 z-40 flex flex-col items-center justify-center gap-10 bg-canvas px-gutter animate-intro">
    <p className="headline text-5xl text-accent animate-stamp">Match found</p>
    <div className="w-full max-w-4xl"><FaceOff you={you} opponent={opponent} size="lg" motion delay={250} /></div>
    <p className="max-w-2xl text-center text-xl font-semibold text-ink-muted animate-rise" style={at(700)}>{topic}</p>
  </div>;
}

function EloLine({ result, side }: { result: ArenaResult; side: Side }) {
  const mine = result.participants.find((participant) => participant.side === side);
  if (mine?.elo_before != null && mine.elo_after != null) {
    const change = mine.elo_after - mine.elo_before;
    return <p className="mt-5 flex items-baseline justify-center gap-3 animate-rise" style={at(REVEAL.elo)}>
      <CountUp from={0} to={change} delay={REVEAL.elo + 150} format={(value) => `${signed(value)}`} className={`stat text-6xl ${eloChangeColor(change)}`} />
      <span className="text-sm text-ink-muted">Elo · now <CountUp from={mine.elo_before} to={mine.elo_after} delay={REVEAL.elo + 150} className="stat text-2xl text-ink" /></span>
    </p>;
  }
  const note = result.status === "voided" ? "Voided debates don’t change ratings."
    : result.status === "forfeited" ? "Ratings don’t change on a forfeit."
    : "Your new rating will show in your match history.";
  return <p className="mt-5 text-sm text-ink-faint animate-rise" style={at(REVEAL.elo)}>{note}</p>;
}

export default function MatchArena() {
  const { state, submitPrompt, resign } = useMatch();
  const { user } = useSession();
  const router = useRouter();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState<"you" | "opponent">("you");
  const [introDone, setIntroDone] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const promptText = useRef<HTMLParagraphElement>(null);
  const promptOrigin = useRef<DOMRect | null>(null);
  const composing = state.phase === "prompting";
  const completed = state.phase === "completed";
  const opponentSide = otherSide(state.side);
  // A daily challenge may cap the prompt below the usual 2,000 characters; the server checks every twist.
  const promptLimit = Math.min(2000, state.challenge?.max_chars ?? 2000);

  useLayoutEffect(() => {
    const origin = promptOrigin.current;
    const target = promptText.current;
    if (!origin || !target || !state.prompt) return;
    promptOrigin.current = null;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const end = target.getBoundingClientRect();
    const animation = target.animate([
      { transform: `translate(${origin.left + 24 - end.left}px, ${origin.top + 20 - end.top}px)` },
      { transform: "translate(0, 0)" },
    ], { duration: 650, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
    return () => animation.cancel();
  }, [state.prompt]);

  function submit(event: FormEvent) {
    event.preventDefault();
    promptOrigin.current = textarea.current?.getBoundingClientRect() ?? null;
    submitPrompt(draft);
  }

  // The face-off: the server's players when it sent them, else this session and an unnamed opponent.
  function player(side: Side): FaceOffPlayer {
    const entry = state.participants.find((participant) => participant.side === side);
    const you = side === state.side;
    const known = entry?.user ?? (you && user?.tag ? { id: user.id, tag: user.tag, username: user.username, avatar_url: user.avatar_url } : null);
    const rating = state.result?.participants.find((participant) => participant.side === side);
    return {
      side, you, name: known ? displayName(known) : you ? "You" : "Opponent", tag: known?.tag ?? null, avatarUrl: known?.avatar_url ?? null,
      elo: rating?.elo_before ?? entry?.elo ?? null, eloAfter: rating?.elo_after ?? null, winner: state.result?.winner === side,
    };
  }
  const me = player(state.side);
  const them = player(opponentSide);

  const viewedSide = tab === "you" ? state.side : opponentSide;
  const result = state.result;
  const won = result?.winner === state.side;
  // Before a result, leaving forfeits; afterwards (or once disconnected) it's a plain link.
  const live = !completed && !state.disconnected;
  async function leave() {
    setLeaving(true);
    await resign();
    router.push("/");
  }

  const header = completed ? "Debate complete" : composing ? "Write your prompt" : state.phase === "connecting" ? "Entering the arena" : "Debate in progress";

  return <PageTransition><div className="min-h-svh bg-canvas font-sans text-ink">
    <header className="grid h-[54px] grid-cols-[1fr_auto_1fr] items-center border-b border-line px-gutter">
      {live
        ? <button type="button" onClick={() => setConfirmLeave(true)} aria-label="Leave the debate and return to the lobby" className="justify-self-start rounded-control focus-ring"><Wordmark /></button>
        : <Link href="/" aria-label="Return to the lobby" className="justify-self-start rounded-control focus-ring"><Wordmark /></Link>}
      <p role="status" className="eyebrow text-ink-muted">{header}</p>
      <div className="justify-self-end text-sm text-ink-muted">{completed || state.disconnected ? <Link href="/" className="rounded-control transition-colors duration-(--duration-fast) hover:text-ink focus-ring">Leave arena ↗</Link> : <span className="stat text-base uppercase tracking-wider">Arena</span>}</div>
    </header>
    <Modal open={confirmLeave} busy={leaving} onClose={() => setConfirmLeave(false)} title="Leave and forfeit?" width="sm">
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">The debate hasn’t been decided yet. If you leave now, you forfeit and your opponent wins.</p>
      <form method="dialog" className="mt-6 flex justify-end gap-3">
        <Button type="submit" autoFocus disabled={leaving}>Stay</Button>
        <Button variant="primary" disabled={leaving} onClick={() => void leave()}>{leaving ? "Leaving…" : "Forfeit and leave"}</Button>
      </form>
    </Modal>

    {!state.topic ? <main className="mx-auto flex min-h-[calc(100svh-54px)] max-w-xl flex-col items-center justify-center gap-6 px-gutter text-center">
      {state.error ? <><p role="alert" className="text-sm text-danger">{state.error}</p><Link href="/" className={buttonClass("primary")}>Back to lobby</Link></>
        : <><span aria-hidden="true" className="h-10 w-10 rounded-full border-[3px] border-accent/20 border-t-accent motion-safe:animate-spin" /><p role="status" className="text-sm text-ink-muted">Waiting for both players to enter the arena…</p></>}
    </main> : <main className={`mx-auto w-full px-gutter pb-14 motion-safe:transition-[padding,max-width] motion-safe:duration-700 motion-safe:ease-out ${completed ? "max-w-[980px] pt-8" : "max-w-[880px] pt-8"}`}>
      {composing && !introDone && <MatchIntro you={me} opponent={them} topic={state.topic.topic} onDone={() => setIntroDone(true)} />}

      {!completed && <div className="panel mb-10 px-panel py-4 animate-fade"><FaceOff you={me} opponent={them} /></div>}

      <section aria-labelledby="topic-title" className="text-center">
        <p className="mb-4 break-words text-sm text-ink-muted">Model · <span className="font-semibold text-ink">{state.model_display_name}</span></p>
        <p className="eyebrow">The topic</p>
        <h1 id="topic-title" className={`mx-auto mt-3 font-bold tracking-tight motion-safe:transition-[font-size,max-width,line-height] motion-safe:duration-700 ${composing ? "max-w-[520px] text-4xl" : "max-w-full text-3xl"}`}>{state.topic.topic}</h1>
        <p className={`font-semibold uppercase tracking-[0.12em] ${composing ? "mt-6 text-sm" : "mt-4 text-xs"}`}><span className={SIDE_TEXT[state.side]}>{completed ? "You" : "Your side"} · {SIDE_LABEL[state.side]}</span>{completed && <><span className="mx-5 font-normal text-ink-faint">|</span><span className={SIDE_TEXT[opponentSide]}>Opponent · {SIDE_LABEL[opponentSide]}</span></>}</p>
        <div className={`grid motion-safe:transition-[grid-template-rows,opacity,margin] motion-safe:duration-700 ${composing ? "mt-2 grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0"}`}><p className="overflow-hidden text-lg text-ink-muted">{state.topic[`${state.side}_position`]}</p></div>
      </section>

      {state.error && <p role="alert" className="mt-6 text-center text-sm text-danger">{state.error}</p>}

      {composing ? <form onSubmit={submit} className="mt-10">
        <div className="mb-4 flex items-end justify-between gap-4"><label htmlFor="player-prompt" className="text-2xl font-semibold tracking-tight">Give your AI a strategy.</label><Countdown deadline={state.deadline} /></div>
        {state.challenge && <p className="mb-4 rounded-inset border border-gold/30 bg-gold/[0.06] px-5 py-3 text-sm text-ink"><span className="font-bold text-gold">Daily challenge · {state.challenge.title}.</span> {state.challenge.description}</p>}
        <textarea ref={textarea} id="player-prompt" autoFocus value={draft} onChange={event => setDraft(event.target.value)} maxLength={promptLimit} disabled={state.disconnected} placeholder="How should your AI make its case?" className="block h-[210px] w-full resize-none rounded-panel border border-line-strong bg-inset px-6 py-5 text-lg leading-relaxed text-ink shadow-pressed placeholder:text-ink-faint transition-colors duration-(--duration-fast) hover:border-ink-faint focus-ring" aria-describedby="prompt-privacy prompt-count" />
        <div className="mt-4 flex items-start justify-between"><p id="prompt-count" className="stat text-base text-ink-muted">{draft.length} / {promptLimit}</p><Button type="submit" variant="primary" size="lg" className="px-9" disabled={!draft.trim() || state.disconnected}>Submit prompt</Button></div>
        <p id="prompt-privacy" className="mt-10 text-center text-sm text-ink-faint">Your prompt stays private.</p>
      </form> : completed && result ? <>
        <section aria-labelledby="verdict-title" className="panel mt-8 px-panel py-9 text-center">
          <p className="eyebrow animate-fade" style={at(REVEAL.verdict)}>The verdict</p>
          <h2 id="verdict-title" className={`headline mt-3 text-7xl animate-stamp ${result.winner === null ? "text-ink-muted" : won ? "text-gold" : "text-ink"}`} style={at(REVEAL.headline)}>{result.winner === null ? "Debate voided." : won ? "You won." : "You lost."}</h2>
          {result.winner && <p className={`stat mx-auto mt-4 w-fit rounded-control border border-current px-5 py-1.5 text-base uppercase tracking-wider animate-pop ${SIDE_TEXT[result.winner]}`} style={at(REVEAL.badge)}>{SIDE_LABEL[result.winner]} wins</p>}
          <EloLine result={result} side={state.side} />
          <div className="well mx-auto mt-7 max-w-3xl px-5 py-4 text-left animate-rise" style={at(REVEAL.elo + 120)}><FaceOff you={me} opponent={them} label="Ratings after the debate" /></div>
          <div className="animate-rise" style={at(REVEAL.reason)}>
            <h3 className="mt-8 text-lg font-semibold">{result.end_reason !== "judged" ? "Why the debate ended" : won ? "Why the judge chose you" : "Why the judge chose your opponent"}</h3>
            <p className="mx-auto mt-1.5 max-w-[690px] whitespace-pre-wrap break-words text-base leading-relaxed text-ink-muted">{result.reason}</p>
          </div>
        </section>
        <section aria-label="Debate arguments" className="panel mt-stack px-panel pb-7 animate-rise" style={at(REVEAL.arguments)}>
          <div role="tablist" aria-label="Choose an argument" className="grid grid-cols-2 border-b border-line">
            {(["you", "opponent"] as const).map(value => <button key={value} type="button" id={`${value}-tab`} role="tab" aria-selected={tab === value} aria-controls="argument-panel" tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? "you" : event.key === "End" ? "opponent" : tab === "you" ? "opponent" : "you"; setTab(next); document.getElementById(`${next}-tab`)?.focus(); } }} className={`min-h-14 border-b-2 text-center text-base font-semibold transition-colors duration-(--duration-fast) focus-ring ${tab === value ? "border-accent text-ink" : "border-transparent text-ink-muted hover:text-ink"}`}>{value === "you" ? "Your argument" : "Opponent’s argument"}</button>)}
          </div>
          <div role="tabpanel" id="argument-panel" aria-labelledby={`${tab}-tab`} tabIndex={0} className="rounded-control pt-5 focus-ring">
            <div className="mb-5 flex items-center gap-3 text-sm font-semibold"><span>{tab === "you" ? me.name : them.name}</span><span className="font-normal text-ink-faint">|</span><span className={`text-xs uppercase tracking-wider ${SIDE_TEXT[viewedSide]}`}>{SIDE_LABEL[viewedSide]}</span></div>
            {tab === "you" && state.prompt !== null && <div className="mb-4 border-b border-line pb-4"><h3 className="eyebrow">Your prompt</h3><p className="mt-1.5 whitespace-pre-wrap break-words text-base leading-relaxed">{state.prompt}</p></div>}
            <h3 className="eyebrow">{tab === "you" ? "Your AI’s argument" : "Opponent’s AI’s argument"}</h3>
            <div className="mt-2 space-y-3 text-lg leading-relaxed">{(result.arguments[viewedSide] || "No argument was generated.").split(/\n\s*\n/).map((paragraph, index) => <p key={index} className="whitespace-pre-wrap break-words">{paragraph}</p>)}</div>
          </div>
        </section>
        <div className="mt-8 text-center animate-fade" style={at(REVEAL.arguments)}><Link href="/" className={buttonClass("primary", "lg", "px-9")}>Back to lobby</Link></div>
      </> : <div className="mt-10">
        {state.prompt !== null && <section aria-labelledby="submitted-label" className="border-b border-line pb-10"><div className="mb-2 flex items-center justify-between"><h2 id="submitted-label" className="eyebrow">Your prompt</h2><span className="text-sm text-ink-muted">Submitted</span></div><p ref={promptText} className="whitespace-pre-wrap break-words text-xl leading-relaxed">{state.prompt}</p></section>}
        <section aria-labelledby="argument-label" className="pt-7">
          <div className="mb-6 flex items-center justify-between"><h2 id="argument-label" className="eyebrow">Your AI’s argument</h2><p role="status" className="flex items-center gap-3 text-sm text-ink-muted">{state.phase === "generating" && !state.disconnected && <span aria-hidden="true" className="h-4 w-4 rounded-full border-2 border-accent/25 border-t-accent motion-safe:animate-spin" />}{state.disconnected ? "Disconnected" : state.phase === "generating" ? "Generating…" : "Complete"}</p></div>
          <p className="whitespace-pre-wrap break-words text-2xl leading-[1.6]">{state.argument}{state.phase === "generating" && !state.disconnected && <span aria-hidden="true" className={`ml-1 inline-block h-6 w-0.5 translate-y-1 motion-safe:animate-pulse ${state.side === "pro" ? "bg-side-pro" : "bg-side-con"}`} />}</p>
        </section>
        {!state.disconnected && (state.phase === "waiting" || state.phase === "judging") && <Waiting judging={state.phase === "judging"} />}
      </div>}
    </main>}
  </div></PageTransition>;
}
