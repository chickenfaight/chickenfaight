"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { parseUser, type Side } from "../lib/protocol";
import { useMatch } from "./providers/match-provider";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";
const eyebrow = "text-xs font-medium uppercase tracking-[0.17em] text-[#bdc5d0]";
const sideColor = (side: Side) => side === "pro" ? "text-[var(--side-pro)]" : "text-[var(--side-con)]";
const primary = `inline-flex h-11 items-center justify-center rounded-xl bg-[#e53848] px-9 text-sm font-semibold text-white transition-colors hover:bg-[#f04b58] disabled:cursor-not-allowed disabled:opacity-40 ${focus}`;

function Countdown({ deadline }: { deadline: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  const seconds = deadline ? Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000)) : null;
  return <div className="text-right"><p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#bdc5d0]">Time to submit</p><p className="mt-1 text-[32px] font-semibold leading-none tabular-nums" role="timer" aria-label="Time remaining to submit">{seconds === null ? "—" : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`}</p></div>;
}

function Waiting({ judging }: { judging: boolean }) {
  return <div role="status" className="mt-8 flex items-center gap-6 rounded-xl border border-[#353b43] bg-white/[0.015] px-9 py-5">
    <span aria-hidden="true" className="h-9 w-9 shrink-0 rounded-full border-[3px] border-[#536a7c]/50 border-t-[#8fb6d1] motion-safe:animate-spin" />
    <div><p className="text-base font-medium">{judging ? "Waiting for the verdict…" : "Waiting for your opponent…"}</p><p className="mt-1 text-sm text-[#aeb8c5]">{judging ? "The judge is reviewing both arguments. Sit tight." : "Your argument is ready. Sit tight."}</p></div>
  </div>;
}

const wordmark = <span className="text-xl font-bold tracking-[-0.045em]">chicken<span className="text-[#f04b58]">fAIght</span>.</span>;

// Asks before forfeiting a live match; `onLeave` resigns and returns to the lobby.
function LeaveDialog({ open, leaving, onLeave, onClose }: { open: boolean; leaving: boolean; onLeave: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);
  return <dialog ref={dialog} onClose={onClose} onCancel={event => { if (leaving) event.preventDefault(); }} aria-labelledby={titleId} className="fixed inset-0 m-auto w-[min(440px,90vw)] rounded-2xl border border-[#353b43] bg-[#1c1f22] p-7 text-[#f5f3ef] backdrop:bg-black/70">
    <h2 id={titleId} className="text-xl font-bold">Leave and forfeit?</h2>
    <p className="mt-2 text-sm leading-relaxed text-[#bdc5d0]">The debate hasn’t been decided yet. If you leave now, you forfeit and your opponent wins.</p>
    <div className="mt-6 flex justify-end gap-3">
      <button autoFocus disabled={leaving} onClick={() => dialog.current?.close()} className={`h-11 rounded-xl border border-[#69727f] px-5 text-sm font-semibold hover:bg-white/5 disabled:opacity-40 ${focus}`}>Stay</button>
      <button disabled={leaving} onClick={onLeave} className={primary.replace("px-9", "px-5")}>{leaving ? "Leaving…" : "Forfeit and leave"}</button>
    </div>
  </dialog>;
}

export default function MatchArena() {
  const { state, submitPrompt, resign } = useMatch();
  const router = useRouter();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState<"you" | "opponent">("you");
  const [username, setUsername] = useState("You");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const promptText = useRef<HTMLParagraphElement>(null);
  const promptOrigin = useRef<DOMRect | null>(null);
  const composing = state.phase === "prompting";
  const completed = state.phase === "completed";
  const opponent: Side = state.side === "pro" ? "con" : "pro";

  useEffect(() => {
    const controller = new AbortController();
    api("/auth/me", controller.signal).then(data => {
      if (!controller.signal.aborted) setUsername(parseUser(data).username || "You");
    }).catch(() => {});
    return () => controller.abort();
  }, []);

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

  const viewedSide = tab === "you" ? state.side : opponent;
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

  return <div className="min-h-svh bg-[#15181b] font-sans text-[#f5f3ef]">
    <header className="grid h-[50px] grid-cols-[1fr_auto_1fr] items-center border-b border-[#363b42] px-6 sm:px-10">
      {live
        ? <button type="button" onClick={() => setConfirmLeave(true)} aria-label="Leave the debate and return to the lobby" className={`justify-self-start ${focus}`}>{wordmark}</button>
        : <Link href="/" aria-label="Return to the lobby" className={`justify-self-start ${focus}`}>{wordmark}</Link>}
      <p role="status" className="text-[11px] font-medium uppercase tracking-[0.2em] text-[#bdc5d0]">{header}</p>
      <div className="justify-self-end text-sm text-[#bdc5d0]">{completed || state.disconnected ? <Link href="/" className={focus}>Leave arena ↗</Link> : "Arena"}</div>
    </header>
    <LeaveDialog open={confirmLeave} leaving={leaving} onLeave={leave} onClose={() => setConfirmLeave(false)} />

    {!state.topic ? <main className="mx-auto flex min-h-[calc(100svh-50px)] max-w-xl flex-col items-center justify-center gap-6 px-6 text-center">
      {state.error ? <><p role="alert" className="text-sm text-red-300">{state.error}</p><Link href="/" className={primary}>Back to lobby</Link></> : <><span aria-hidden="true" className="h-9 w-9 rounded-full border-2 border-white/10 border-t-[#8fb6d1] motion-safe:animate-spin" /><p role="status" className="text-sm text-[#aeb8c5]">Waiting for both players to enter the arena…</p></>}
    </main> : <main className={`mx-auto w-full px-6 pb-12 motion-safe:transition-[padding,max-width] motion-safe:duration-700 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)] ${completed ? "max-w-[958px] pt-12" : composing ? "max-w-[864px] pt-[clamp(64px,11.5vh,120px)]" : "max-w-[864px] pt-[88px]"}`}>
      <section aria-labelledby="topic-title" className="text-center">
        <p className={eyebrow}>The topic</p>
        <h1 id="topic-title" className={`mx-auto mt-3 font-bold tracking-[-0.04em] motion-safe:transition-[font-size,max-width,line-height] motion-safe:duration-700 ${composing ? "max-w-[450px] text-[40px] leading-[1.2]" : "max-w-full text-[30px] leading-[1.25]"}`}>{state.topic.topic}</h1>
        <p className={`font-semibold uppercase tracking-[0.12em] ${composing ? "mt-6 text-sm" : "mt-4 text-xs"}`}><span className={sideColor(state.side)}>{completed ? "You" : "Your side"} · {state.side}</span>{completed && <><span className="mx-5 font-normal text-[#68717c]">|</span><span className={sideColor(opponent)}>Opponent · {opponent}</span></>}</p>
        <div className={`grid motion-safe:transition-[grid-template-rows,opacity,margin] motion-safe:duration-700 ${composing ? "mt-2 grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0"}`}><p className="overflow-hidden text-lg text-[#bdc5d0]">{state.topic[`${state.side}_position`]}</p></div>
      </section>

      {state.error && <p role="alert" className="mt-6 text-center text-sm text-red-300">{state.error}</p>}

      {composing ? <form onSubmit={submit} className="mt-8">
        <div className="mb-4 flex items-end justify-between gap-4"><label htmlFor="player-prompt" className="text-[22px] font-semibold tracking-tight">Give your AI a strategy.</label><Countdown deadline={state.deadline} /></div>
        <textarea ref={textarea} id="player-prompt" autoFocus value={draft} onChange={event => setDraft(event.target.value)} maxLength={2000} disabled={state.disconnected} placeholder="How should your AI make its case?" className={`block h-[202px] w-full resize-none rounded-xl border border-[#69727f] bg-[#202328] px-6 py-5 text-lg leading-relaxed placeholder:text-[#7f8995] ${focus}`} aria-describedby="prompt-privacy prompt-count" />
        <div className="mt-4 flex items-start justify-between"><p id="prompt-count" className="text-xs font-medium tracking-wider text-[#aeb8c5]">{draft.length} / 2000</p><button type="submit" disabled={!draft.trim() || state.disconnected} className={primary}>Submit prompt</button></div>
        <p id="prompt-privacy" className="mt-10 text-center text-sm text-[#aeb8c5]">Your prompt stays private.</p>
      </form> : completed && result ? <>
        <section aria-labelledby="verdict-title" className="mt-6 rounded-2xl border border-[#353b43] bg-[#1c1f22] px-10 py-7 text-center">
          <p className={eyebrow}>The verdict</p>
          <h2 id="verdict-title" className="mt-1 text-[56px] font-bold leading-[1.1] tracking-[-0.045em]">{result.winner === null ? "Debate voided." : won ? "You won." : "You lost."}</h2>
          {result.winner && <p className={`mx-auto mt-3 w-fit rounded-full border border-current px-5 py-1.5 text-xs font-bold uppercase tracking-wider ${sideColor(result.winner)}`}>{result.winner} wins</p>}
          <h3 className="mt-6 text-lg font-semibold">{result.end_reason !== "judged" ? "Why the debate ended" : won ? "Why the judge chose you" : "Why the judge chose your opponent"}</h3>
          <p className="mx-auto mt-1 max-w-[690px] whitespace-pre-wrap break-words text-[17px] leading-relaxed text-[#bdc5d0]">{result.reason}</p>
        </section>
        <section aria-label="Debate arguments" className="mt-4 rounded-2xl border border-[#353b43] bg-[#1c1f22] px-7 pb-7">
          <div role="tablist" aria-label="Choose an argument" className="grid grid-cols-2 border-b border-[#353b43]">
            {(["you", "opponent"] as const).map(value => <button key={value} id={`${value}-tab`} role="tab" aria-selected={tab === value} aria-controls="argument-panel" tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? "you" : event.key === "End" ? "opponent" : tab === "you" ? "opponent" : "you"; setTab(next); document.getElementById(`${next}-tab`)?.focus(); } }} className={`min-h-14 border-b-2 text-center text-base font-semibold transition-colors ${focus} ${tab === value ? "border-[#e53848] text-[#f5f3ef]" : "border-transparent text-[#9da7b4] hover:text-white"}`}>{value === "you" ? "Your argument" : "Opponent’s argument"}</button>)}
          </div>
          <div role="tabpanel" id="argument-panel" aria-labelledby={`${tab}-tab`} tabIndex={0} className={`pt-5 ${focus}`}>
            <div className="mb-5 flex items-center gap-3 text-sm font-semibold"><span aria-hidden="true" className={`flex h-9 w-9 items-center justify-center rounded-full border border-current text-xs ${sideColor(viewedSide)}`}>{tab === "you" ? username.slice(0, 2).toUpperCase() : "OP"}</span><span>{tab === "you" ? username : "Opponent"}</span><span className="font-normal text-[#68717c]">|</span><span className={`text-xs uppercase tracking-wider ${sideColor(viewedSide)}`}>{viewedSide}</span></div>
            {tab === "you" && state.prompt !== null && <div className="mb-4 border-b border-[#353b43] pb-4"><h3 className={`${eyebrow} text-[10px]`}>Your prompt</h3><p className="mt-1 whitespace-pre-wrap break-words text-base leading-relaxed">{state.prompt}</p></div>}
            <h3 className={`${eyebrow} text-[10px]`}>{tab === "you" ? "Your AI’s argument" : "Opponent’s AI’s argument"}</h3>
            <div className="mt-2 space-y-3 text-[17px] leading-relaxed">{(result.arguments[viewedSide] || "No argument was generated.").split(/\n\s*\n/).map((paragraph, index) => <p key={index} className="whitespace-pre-wrap break-words">{paragraph}</p>)}</div>
          </div>
        </section>
        <div className="mt-7 text-center"><Link href="/" className={primary}>Back to lobby</Link></div>
      </> : <div className="mt-8">
        {state.prompt !== null && <section aria-labelledby="submitted-label" className="border-b border-[#414850] pb-10"><div className="mb-2 flex items-center justify-between"><h2 id="submitted-label" className={eyebrow}>Your prompt</h2><span className="text-sm text-[#bdc5d0]">Submitted</span></div><p ref={promptText} className="whitespace-pre-wrap break-words text-xl leading-relaxed">{state.prompt}</p></section>}
        <section aria-labelledby="argument-label" className="pt-7">
          <div className="mb-6 flex items-center justify-between"><h2 id="argument-label" className={eyebrow}>Your AI’s argument</h2><p role="status" className="flex items-center gap-3 text-sm text-[#bdc5d0]"><span className={`h-2.5 w-2.5 rounded-full ${state.phase === "generating" ? "bg-[var(--side-pro)] motion-safe:animate-pulse" : "bg-[#8ca4ba]"}`} />{state.disconnected ? "Disconnected" : state.phase === "generating" ? "Generating…" : "Complete"}</p></div>
          <p className="whitespace-pre-wrap break-words text-[23px] leading-[1.6]">{state.argument}{state.phase === "generating" && !state.disconnected && <span aria-hidden="true" className="ml-1 inline-block h-6 w-px translate-y-1 bg-[var(--side-pro)] motion-safe:animate-pulse" />}</p>
        </section>
        {!state.disconnected && (state.phase === "waiting" || state.phase === "judging") && <Waiting judging={state.phase === "judging"} />}
      </div>}
    </main>}
  </div>;
}
