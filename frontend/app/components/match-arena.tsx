"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
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

// Ratings follow the result with a short animation. The verdict and its reason are visible at once.
const at = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

const PHASE_LABEL = {
  connecting: "Waiting for both players…",
  prompting: "Write your prompt",
  generating: "Generating your argument…",
  waiting: "Waiting for your opponent…",
  judging: "Waiting for the verdict…",
  completed: "Debate complete",
};

function Countdown({ deadline }: { deadline: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  const seconds = deadline ? Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000)) : null;
  const urgent = seconds !== null && seconds <= 15;
  if (seconds === null) return null;
  return <div className="text-right">
    <p className="text-xs font-semibold text-ink-muted">Time to submit</p>
    <p className={`stat mt-1 text-3xl transition-colors duration-(--duration-slow) sm:text-4xl ${urgent ? "text-accent-ink" : ""}`} role="timer" aria-label="Time remaining to submit">
      {`${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`}
    </p>
  </div>;
}

function EloLine({ result, side }: { result: ArenaResult; side: Side }) {
  const mine = result.participants.find((participant) => participant.side === side);
  if (mine?.elo_before != null && mine.elo_after != null) {
    const change = mine.elo_after - mine.elo_before;
    return <p className="mt-5 flex items-baseline justify-center gap-3 animate-rise" style={at(220)}>
      <CountUp from={0} to={change} delay={220} format={signed} className={`stat text-5xl ${eloChangeColor(change)}`} />
      <span className="text-sm text-ink-muted">Elo · now <CountUp from={mine.elo_before} to={mine.elo_after} delay={220} className="stat text-2xl text-ink" /></span>
    </p>;
  }
  const note = result.status === "voided" ? "Voided debates don’t change ratings."
    : result.status === "forfeited" ? "Ratings don’t change on a forfeit."
    : "Your new rating will show in your debate history.";
  return <p className="mt-5 text-sm text-ink-muted">{note}</p>;
}

export default function MatchArena() {
  const { state, submitPrompt, resign } = useMatch();
  const { user } = useSession();
  const router = useRouter();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState<"you" | "opponent">("you");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const argumentTitle = useRef<HTMLHeadingElement>(null);
  const verdictTitle = useRef<HTMLHeadingElement>(null);
  const { phase, disconnected, error, promptClosed, topic, result } = state;
  const previousPhase = useRef(phase);
  const composing = phase === "prompting";
  const completed = phase === "completed";
  // A result can arrive before the initial match state if the opponent never connects.
  const ownSide = topic ? state.side : result?.participants.find(participant => participant.user_id === user?.id)?.side;
  const playerSide = ownSide ?? state.side;
  const opponentSide = otherSide(playerSide);
  const canEdit = !disconnected && !promptClosed;
  // A daily challenge may cap the prompt below the usual 2,000 characters; the server checks every twist.
  const promptLimit = Math.min(2000, state.challenge?.max_chars ?? 2000);

  useEffect(() => {
    const previous = previousPhase.current;
    previousPhase.current = phase;
    if (phase === "prompting" && error && !disconnected && !leaving) {
      textarea.current?.focus();
      return;
    }
    if (previous === phase || leaving) return;
    if (phase === "completed") {
      // Focus after a pending leave dialog has closed.
      const frame = requestAnimationFrame(() => verdictTitle.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
    if (previous === "prompting") argumentTitle.current?.focus();
  }, [phase, error, disconnected, leaving]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (canEdit) submitPrompt(draft);
  }

  // The face-off: the server's players when it sent them, else this session and an unnamed opponent.
  function player(side: Side): FaceOffPlayer {
    const entry = state.participants.find((participant) => participant.side === side);
    const you = side === playerSide;
    const known = entry?.user ?? (you && user?.tag ? { id: user.id, tag: user.tag, username: user.username, avatar_url: user.avatar_url } : null);
    const rating = state.result?.participants.find((participant) => participant.side === side);
    return {
      side, you, name: known ? displayName(known) : you ? "You" : "Opponent", tag: known?.tag ?? null, avatarUrl: known?.avatar_url ?? null,
      elo: rating?.elo_before ?? entry?.elo ?? null, eloAfter: rating?.elo_after ?? null, winner: state.result?.winner === side,
    };
  }
  const me = player(playerSide);
  const them = player(opponentSide);

  const viewedSide = tab === "you" ? playerSide : opponentSide;
  const won = result?.winner != null && (ownSide ? result.winner === ownSide : result.end_reason === "no_show");
  const VerdictHeading = topic ? "h2" : "h1";
  const ReasonHeading = topic ? "h3" : "h2";
  const live = !completed && !disconnected;
  const generating = phase === "generating" && !disconnected;
  async function leave() {
    setLeaving(true);
    await resign();
    router.push("/");
  }

  const status = disconnected ? topic ? "Connection lost" : "Debate unavailable"
    : composing && promptClosed ? "Prompt window closed" : PHASE_LABEL[phase];

  return <PageTransition><div className="min-h-svh bg-canvas font-sans text-ink">
    <header className="sticky top-0 z-30 border-b border-line bg-canvas">
      <div className="mx-auto grid min-h-14 max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-gutter py-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="justify-self-start"><Wordmark /></div>
        <p role="status" className={`order-3 col-span-2 text-sm font-semibold sm:order-none sm:col-span-1 ${disconnected ? "text-danger" : "text-ink-muted"}`}>{status}</p>
        <div className="justify-self-end">
          {live ? <Button variant="ghost" aria-haspopup="dialog" onClick={() => setConfirmLeave(true)}>Leave debate…</Button>
            : <Link href="/" className={buttonClass("ghost", "md")}>Back to lobby</Link>}
        </div>
      </div>
    </header>
    <Modal open={live && confirmLeave} busy={leaving} onClose={() => setConfirmLeave(false)} title="Leave and forfeit?" width="sm"
      description="If you leave now, you forfeit and your opponent wins.">
      <form method="dialog" className="mt-6 flex flex-wrap justify-end gap-2 sm:gap-3">
        <Button type="submit" autoFocus disabled={leaving}>Stay</Button>
        <Button variant="primary" disabled={leaving} onClick={() => void leave()}>{leaving ? "Leaving…" : "Forfeit and leave"}</Button>
      </form>
    </Modal>

    {!topic && !result ? <main className="mx-auto flex min-h-[calc(100svh-6rem)] max-w-xl flex-col items-center justify-center gap-6 px-gutter text-center">
      {error ? <p role="alert" className="text-sm text-danger">{error}</p>
        : <span aria-hidden="true" className="h-10 w-10 rounded-full border-[3px] border-accent/20 border-t-accent motion-safe:animate-spin" />}
    </main> : <main className={`mx-auto w-full min-w-0 px-gutter pb-12 pt-4 sm:pt-7 ${completed ? "max-w-[980px]" : "max-w-[880px]"}`}>
      {!completed && <div className="mb-5 rounded-control border border-line bg-surface px-3 py-2 sm:mb-6 sm:px-5 sm:py-3">
        <FaceOff you={me} opponent={them} compact />
      </div>}

      {topic && <section aria-labelledby="topic-title" className="sm:text-center">
        <p className="mb-1.5 wrap-anywhere text-sm text-ink-muted">Model · <span className="font-semibold text-ink">{state.model_display_name}</span></p>
        <h1 id="topic-title" className={`wrap-anywhere font-bold tracking-tight sm:mx-auto sm:text-balance ${composing ? "max-w-[700px] text-3xl sm:text-4xl" : "text-2xl sm:text-3xl"}`}>{topic.topic}</h1>
        {composing ? <div className="mt-4 flex items-start justify-between gap-4 border-y border-line py-3 text-left sm:mt-5 sm:items-center">
          <div className="min-w-0">
            <p className={`text-sm font-semibold ${SIDE_TEXT[playerSide]}`}>Your side · {SIDE_LABEL[playerSide]}</p>
            <p id="prompt-position" className="mt-1 wrap-anywhere text-base text-ink-muted">{topic[`${playerSide}_position`]}</p>
          </div>
          {canEdit && <Countdown deadline={state.deadline} />}
        </div> : <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm font-semibold sm:justify-center">
          <span className={SIDE_TEXT[playerSide]}>{completed ? "You" : "Your side"} · {SIDE_LABEL[playerSide]}</span>
          {completed && <span className={SIDE_TEXT[opponentSide]}>Opponent · {SIDE_LABEL[opponentSide]}</span>}
        </p>}
      </section>}

      {!composing && error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}

      {composing ? <form method="post" onSubmit={submit} className="mt-4 sm:mt-5">
        <label htmlFor="player-prompt" className="block text-lg font-semibold sm:text-xl">Give your AI a strategy</label>
        {state.challenge && <p id="prompt-challenge" className="mt-2 rounded-control border border-gold/30 bg-gold/[0.06] px-3 py-2 text-sm text-ink"><span className="font-bold text-gold">{state.challenge.title}.</span> {state.challenge.description}</p>}
        {error && <p id="prompt-error" role="alert" className="mt-2 text-sm text-danger">{error}</p>}
        <textarea ref={textarea} id="player-prompt" value={draft} onChange={event => setDraft(event.target.value)} maxLength={promptLimit} readOnly={!canEdit}
          placeholder="How should your AI make its case?" className="mt-2.5 block h-28 w-full scroll-mt-28 scroll-mb-20 resize-y rounded-control border border-line-strong bg-inset px-3.5 py-3 text-base leading-relaxed text-ink placeholder:text-ink-faint transition-colors duration-(--duration-fast) hover:border-ink-faint focus-ring sm:h-48 sm:px-5 sm:py-4"
          aria-invalid={Boolean(error && canEdit)} aria-describedby={`prompt-position ${state.challenge ? "prompt-challenge " : ""}${error ? "prompt-error " : ""}prompt-count prompt-privacy`} />
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 bg-canvas py-2 sm:static">
          <p id="prompt-count" className="text-sm tabular-nums text-ink-muted">{draft.length} / {promptLimit} characters</p>
          <Button type="submit" variant="primary" size="lg" aria-disabled={!draft.trim() || !canEdit}>Submit prompt</Button>
        </div>
        <p id="prompt-privacy" className="mt-1.5 max-w-[72ch] text-sm text-ink-muted">Your prompt goes to the argument model on the cloud inference service or your own device. The judge and your opponent see generated arguments, which may repeat parts of your prompt.</p>
      </form> : completed && result ? <>
        <section aria-labelledby="verdict-title" className="panel mt-6 p-panel text-center sm:py-8">
          <VerdictHeading ref={verdictTitle} tabIndex={-1} id="verdict-title" className={`headline scroll-mt-28 rounded-control text-6xl focus-ring ${result.winner === null ? "text-ink-muted" : won ? "text-gold" : "text-ink"}`}>
            {result.winner === null ? "Debate voided." : won ? "You won." : ownSide ? "You lost." : "Debate ended."}
          </VerdictHeading>
          <div className="mt-4">
            <ReasonHeading className="text-lg font-semibold">{result.end_reason !== "judged" ? "Why the debate ended" : won ? "Why the judge chose you" : "Why the judge chose your opponent"}</ReasonHeading>
            <p className="mx-auto mt-1.5 max-w-[72ch] whitespace-pre-wrap wrap-anywhere text-base leading-relaxed text-ink-muted">{result.reason}</p>
          </div>
          <EloLine result={result} side={playerSide} />
          {topic && <div className="well mx-auto mt-5 max-w-3xl px-3 py-3 text-left sm:px-5 sm:py-4"><FaceOff you={me} opponent={them} label="Ratings after the debate" /></div>}
        </section>
        {topic && <section aria-label="Debate arguments" className="panel mt-stack px-panel pb-7">
          <div role="tablist" aria-label="Choose an argument" className="grid grid-cols-2 border-b border-line">
            {(["you", "opponent"] as const).map(value => <button key={value} type="button" id={`${value}-tab`} role="tab" aria-selected={tab === value} aria-controls="argument-panel" tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? "you" : event.key === "End" ? "opponent" : tab === "you" ? "opponent" : "you"; setTab(next); document.getElementById(`${next}-tab`)?.focus(); } }} className={`min-h-14 border-b-2 text-center text-base font-semibold transition-colors duration-(--duration-fast) focus-ring ${tab === value ? "border-accent text-ink" : "border-transparent text-ink-muted hover:text-ink"}`}>{value === "you" ? "Your argument" : "Opponent’s argument"}</button>)}
          </div>
          <div role="tabpanel" id="argument-panel" aria-labelledby={`${tab}-tab`} tabIndex={0} className="rounded-control pt-5 focus-ring">
            <div className="mb-5 flex flex-wrap items-center gap-3 text-sm font-semibold"><span className="min-w-0 wrap-anywhere">{tab === "you" ? me.name : them.name}</span><span className="font-normal text-ink-faint">|</span><span className={`text-xs uppercase tracking-wider ${SIDE_TEXT[viewedSide]}`}>{SIDE_LABEL[viewedSide]}</span></div>
            {tab === "you" && state.prompt !== null && <div className="mb-4 border-b border-line pb-4"><h3 className="eyebrow">Your prompt</h3><p className="mt-1.5 whitespace-pre-wrap wrap-anywhere text-base leading-relaxed">{state.prompt}</p></div>}
            <h3 className="eyebrow">{tab === "you" ? "Your AI’s argument" : "Opponent’s AI’s argument"}</h3>
            <div className="mt-2 space-y-3 text-lg leading-relaxed">{(result.arguments[viewedSide] || "No argument was generated.").split(/\n\s*\n/).map((paragraph, index) => <p key={index} className="whitespace-pre-wrap wrap-anywhere">{paragraph}</p>)}</div>
          </div>
        </section>}
        <div className="mt-8 text-center"><Link href="/" className={buttonClass("primary", "lg", "px-9")}>Find another debate</Link></div>
      </> : <div className="mt-6">
        {state.prompt !== null && <details className="rounded-control border border-line bg-surface px-4 py-3">
          <summary className="cursor-pointer rounded-sm text-sm font-semibold focus-ring">Your submitted prompt</summary>
          <p className="mt-2 whitespace-pre-wrap wrap-anywhere text-base leading-relaxed">{state.prompt}</p>
        </details>}
        <section aria-labelledby="argument-label" className="mt-5">
          <h2 ref={argumentTitle} tabIndex={-1} id="argument-label" className="mb-3 w-fit scroll-mt-28 rounded-control text-xl font-semibold focus-ring">Your AI’s argument</h2>
          <p className="max-w-[72ch] whitespace-pre-wrap wrap-anywhere text-lg leading-relaxed sm:text-xl">{state.argument}{generating && <span aria-hidden="true" className={`ml-1 inline-block h-4 w-0.5 translate-y-0.5 motion-safe:animate-pulse ${playerSide === "pro" ? "bg-side-pro" : "bg-side-con"}`} />}</p>
        </section>
      </div>}
    </main>}
  </div></PageTransition>;
}
