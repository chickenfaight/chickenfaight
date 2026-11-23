"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type Ref } from "react";
import { eloChangeColor, otherSide, SIDE_LABEL, SIDE_TEXT, signed } from "../lib/matches";
import { displayName, type ArenaResult, type ArenaTopic, type Side } from "../lib/protocol";
import Button, { buttonClass } from "./button";
import CountUp from "./count-up";
import FaceOff, { type FaceOffPlayer } from "./face-off";
import JudgeScorecard from "./judge-scorecard";
import Modal from "./modal";
import PageTransition from "./page-transition";
import { useMatch } from "./providers/match-provider";
import { useSession } from "./providers/session-provider";
import Skeleton from "./skeleton";
import { Wordmark } from "./site-header";

// Ratings follow the verdict with a short animation.
const at = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

const PHASE_LABEL = {
  connecting: "Waiting for both players…",
  choosing: "Side selection is open",
  introducing: "Preparing the debate…",
  prompting: "Write your prompt",
  generating: "Generating your argument…",
  waiting: "Waiting for your opponent…",
  judging: "Waiting for the verdict…",
  completed: "Debate complete",
};

function Countdown({ deadline, action }: { deadline: string | null; action: "choose" | "submit" }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  const seconds = deadline ? Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000)) : null;
  if (seconds === null) return null;
  const urgent = seconds <= (action === "choose" ? 5 : 15);
  return <div className="shrink-0 text-right">
    <p className="text-xs font-semibold text-ink-muted">Time to {action}</p>
    <p className={`stat mt-1 text-3xl transition-colors duration-(--duration-slow) sm:text-4xl ${urgent ? "text-accent-ink" : ""}`} role="timer" aria-label={`Time remaining to ${action}`}>
      {`${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`}
    </p>
  </div>;
}

function SideChooser({ topic, deadline, disabled, chooseSide, headingRef }: {
  topic: ArenaTopic; deadline: string | null; disabled: boolean; chooseSide: (side: Side) => void; headingRef: Ref<HTMLHeadingElement>;
}) {
  return <>
    <h1 ref={headingRef} tabIndex={-1} aria-describedby="selection-topic" className="headline scroll-mt-28 rounded-control text-center text-5xl text-accent-ink focus-ring sm:text-6xl">Choose your side</h1>
    <h2 id="selection-topic" className="max-w-2xl wrap-anywhere text-center text-xl font-semibold text-balance sm:text-2xl">{topic.topic}</h2>
    <div className="w-full max-w-4xl">
      <div className="mb-3 flex justify-end"><Countdown deadline={deadline} action="choose" /></div>
      <div className="grid gap-3 sm:grid-cols-2 sm:gap-5">
        {(["pro", "con"] as const).map(side => <Button key={side} size="lg"
          className="h-auto! min-h-28 w-full min-w-0 cursor-pointer flex-col items-start! justify-start! gap-2.5 rounded-panel! px-4! py-4 text-left whitespace-normal! touch-manipulation scroll-mt-28 sm:min-h-44 sm:px-6! sm:py-6"
          aria-disabled={disabled} onClick={() => { if (!disabled) chooseSide(side); }}>
          <span className={`headline text-3xl ${SIDE_TEXT[side]}`}>{SIDE_LABEL[side]}</span>
          <span className="whitespace-pre-wrap wrap-anywhere text-base font-medium leading-relaxed text-ink sm:text-lg">{topic[`${side}_position`]}</span>
        </Button>)}
      </div>
    </div>
  </>;
}

function EloLine({ result, side }: { result: ArenaResult; side: Side | null }) {
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
  const { state, chooseSide, submitPrompt, resign } = useMatch();
  const { user } = useSession();
  const router = useRouter();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState<"you" | "opponent">("you");
  const chooserTitle = useRef<HTMLHeadingElement>(null);
  const introTitle = useRef<HTMLHeadingElement>(null);
  const assignedSideTitle = useRef<HTMLHeadingElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const argumentTitle = useRef<HTMLHeadingElement>(null);
  const verdictTitle = useRef<HTMLHeadingElement>(null);
  const { phase, disconnected, error, promptClosed, topic, result } = state;
  const previousPhase = useRef(phase);
  const choosing = phase === "choosing";
  const introducing = phase === "introducing";
  const composing = phase === "prompting";
  const completed = phase === "completed";
  const playerSide = state.side;
  const opponentSide = playerSide === null ? null : otherSide(playerSide);
  // A no-show or resignation can decide the result before the arena has assigned the sides.
  const ownSide = playerSide ?? result?.participants.find(participant => participant.user_id === user?.id)?.side ?? null;
  const canEdit = !disconnected && !promptClosed;
  // A daily challenge may cap the prompt below the usual 2,000 characters; the server checks every twist.
  const promptLimit = Math.min(2000, state.challenge?.max_chars ?? 2000);

  useEffect(() => {
    const previous = previousPhase.current;
    previousPhase.current = phase;
    if (phase === "prompting" && error && !disconnected && !confirmLeave) {
      textarea.current?.focus();
      return;
    }
    if (previous === phase || leaving) return;
    if (phase === "completed") {
      // Focus after a pending leave dialog has closed.
      const frame = requestAnimationFrame(() => verdictTitle.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
    if (confirmLeave || disconnected) return;
    if (phase === "choosing") chooserTitle.current?.focus();
    if (phase === "introducing") introTitle.current?.focus();
    if (phase === "prompting" && (previous === "choosing" || previous === "introducing")) assignedSideTitle.current?.focus();
    if (previous === "prompting") argumentTitle.current?.focus();
  }, [phase, error, disconnected, leaving, confirmLeave]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (canEdit) submitPrompt(draft);
  }

  // The face-off: the server's players when it sent them, else this session and an unnamed opponent.
  function player(you: boolean): FaceOffPlayer {
    const side = you ? playerSide : opponentSide;
    const entry = state.participants.find(participant => participant.side === side);
    const known = entry?.user ?? (you && user?.tag ? { id: user.id, tag: user.tag, username: user.username, avatar_url: user.avatar_url } : null);
    const rating = state.result?.participants.find((participant) => participant.side === side);
    return {
      side, you, name: known ? displayName(known) : you ? "You" : "Opponent", tag: known?.tag ?? null, avatarUrl: known?.avatar_url ?? null,
      elo: rating?.elo_before ?? entry?.elo ?? null, eloAfter: rating?.elo_after ?? null, winner: side !== null && state.result?.winner === side,
    };
  }
  const me = player(true);
  const them = player(false);

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
    : composing && promptClosed ? "Prompt window closed"
    : choosing && state.pickPending ? "Locking in your side…" : PHASE_LABEL[phase];

  return <PageTransition><div className="min-h-svh bg-canvas font-sans text-ink">
    <a href="#main-content" className="fixed left-4 top-4 z-50 -translate-y-24 rounded-control bg-ink px-5 py-3 text-sm font-semibold text-canvas focus:translate-y-0 focus-ring">Skip to content</a>
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

    {topic && (choosing || introducing) ? <main id="main-content" tabIndex={-1}
      className="mx-auto flex min-h-[calc(100svh-6rem)] w-full flex-col items-center justify-center gap-4 scroll-mt-28 px-gutter py-5 sm:gap-6 sm:py-8">
      {choosing ? <SideChooser topic={topic} deadline={state.deadline} disabled={disconnected || state.pickPending} chooseSide={chooseSide} headingRef={chooserTitle} /> : <>
        <div className="w-full max-w-2xl text-center motion-safe:animate-fade">
          <h1 ref={introTitle} tabIndex={-1} aria-describedby={playerSide ? "intro-position" : undefined} className="headline mx-auto w-fit max-w-full scroll-mt-28 rounded-control text-5xl focus-ring sm:text-6xl">
            Your side{playerSide && <> · <span className={SIDE_TEXT[playerSide]}>{SIDE_LABEL[playerSide]}</span></>}
          </h1>
          {playerSide && <p id="intro-position" className="mt-2 whitespace-pre-wrap wrap-anywhere text-base leading-relaxed text-ink-muted sm:text-xl">{topic[`${playerSide}_position`]}</p>}
        </div>
        <div className="panel w-full max-w-4xl px-3 py-5 sm:px-7 sm:py-8"><FaceOff you={me} opponent={them} presentation="intro" /></div>
        <p className="max-w-2xl wrap-anywhere text-center text-lg font-semibold text-balance text-ink-muted sm:text-xl">{topic.topic}</p>
      </>}
      {error && <p role="alert" className="max-w-xl text-center text-sm text-danger">{error}</p>}
    </main> : !topic && !result ? <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[880px] scroll-mt-28 px-gutter pb-12 pt-4 sm:pt-7">
      {error ? <p role="alert" className="text-sm text-danger">{error}</p>
        : <div aria-hidden="true"><Skeleton label="Waiting for both players…" variant="block" height="h-16" /></div>}
    </main> : <main id="main-content" tabIndex={-1} className={`mx-auto w-full min-w-0 scroll-mt-28 px-gutter pb-12 pt-4 sm:pt-7 ${completed ? "max-w-[980px]" : "max-w-[880px]"}`}>
      {!completed && <div className="mb-5 rounded-control border border-line bg-surface px-3 py-2 sm:mb-6 sm:px-5 sm:py-3">
        <FaceOff you={me} opponent={them} presentation="compact" />
      </div>}

      {topic && <section aria-labelledby="topic-title" className="sm:text-center">
        <p className="mb-1.5 wrap-anywhere text-sm text-ink-muted">Model · <span className="font-semibold text-ink">{state.model_display_name}</span></p>
        <h1 id="topic-title" className={`wrap-anywhere font-bold tracking-tight sm:mx-auto sm:text-balance ${composing ? "max-w-[700px] text-3xl sm:text-4xl" : "text-2xl sm:text-3xl"}`}>{topic.topic}</h1>
        {composing && playerSide ? <div className="mt-4 flex items-start justify-between gap-4 border-y border-line py-3 text-left sm:mt-5 sm:items-center">
          <div className="min-w-0">
            <h2 ref={assignedSideTitle} tabIndex={-1} aria-describedby="prompt-position" className={`w-fit scroll-mt-28 rounded-control text-sm font-semibold focus-ring ${SIDE_TEXT[playerSide]}`}>Your side · {SIDE_LABEL[playerSide]}</h2>
            <p id="prompt-position" className="mt-1 wrap-anywhere text-base text-ink-muted">{topic[`${playerSide}_position`]}</p>
          </div>
          {canEdit && <Countdown deadline={state.deadline} action="submit" />}
        </div> : playerSide && opponentSide && <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm font-semibold sm:justify-center">
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
          {result.scorecard && <JudgeScorecard scorecard={result.scorecard} you={ownSide} heading={ReasonHeading} />}
          <div className={result.scorecard ? "mt-6 border-t border-line pt-5" : "mt-4"}>
            <ReasonHeading className="text-lg font-semibold">{result.end_reason !== "judged" ? "Why the debate ended" : won ? "Why the judge chose you" : "Why the judge chose your opponent"}</ReasonHeading>
            <p className="mx-auto mt-1.5 max-w-[72ch] whitespace-pre-wrap wrap-anywhere text-base leading-relaxed text-ink-muted">{result.reason}</p>
          </div>
          <EloLine result={result} side={ownSide} />
          {playerSide && <div className="well mx-auto mt-5 max-w-3xl px-3 py-3 text-left sm:px-5 sm:py-4"><FaceOff you={me} opponent={them} label="Ratings after the debate" /></div>}
        </section>
        {viewedSide && <section aria-label="Debate arguments" className="panel mt-stack px-panel pb-7">
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
      </> : playerSide && <div className="mt-6">
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
