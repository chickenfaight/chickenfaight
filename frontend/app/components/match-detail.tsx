"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { eloChange, endReasonLabel, formatEloChange, modelLabel, opponentName, OUTCOME_COLOR, OUTCOME_LABEL } from "../lib/matches";
import { parseMatchDetail, type MatchDetail as Match, type Side } from "../lib/protocol";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";
const panel = "rounded-3xl border border-white/[0.07] bg-[#202124]";
const sideColor = (side: Side) => side === "pro" ? "text-[var(--side-pro)]" : "text-[var(--side-con)]";
const HEADING = { win: "You won.", loss: "You lost.", void: "Debate voided." };

function Argument({ match, side }: { match: Match; side: Side }) {
  const turn = match.turns.find((candidate) => candidate.side === side);
  const position = side === "pro" ? match.pro_position : match.con_position;
  return <section aria-label={`${side} argument`} className={`${panel} min-w-0 p-6`}>
    <p className="text-xs font-bold uppercase tracking-wider"><span className={sideColor(side)}>{side}</span> <span className="text-zinc-400">· {side === match.you ? "You" : opponentName(match)}</span></p>
    {position && <p className="mt-1 text-xs text-zinc-500">{position}</p>}
    {/* Model output is untrusted: plain text only. */}
    {turn ? <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed">{turn.content}</p>
      : <p className="mt-4 text-sm text-zinc-500">No argument was generated.</p>}
    {turn?.truncated && <p className="mt-3 text-xs text-zinc-500">Cut off at the length limit.</p>}
  </section>;
}

// One finished debate: who won and why, and both arguments. Player prompts are never saved.
export default function MatchDetail({ matchId }: { matchId: string }) {
  const [match, setMatch] = useState<Match | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setPhase("loading");
      try {
        const found = parseMatchDetail(await api(`/v1/matches/${encodeURIComponent(matchId)}`, controller.signal));
        if (controller.signal.aborted) return;
        setMatch(found);
        setPhase("ready");
      } catch (err) {
        if (controller.signal.aborted) return;
        // 422 is an ID that isn't one, which is as missing as any other.
        setPhase(err instanceof ApiError && (err.status === 404 || err.status === 422) ? "missing" : "error");
      }
    }
    void load();
    return () => controller.abort();
  }, [matchId, attempt]);

  const back = <Link href="/matches" className={`text-xs text-zinc-400 hover:text-white ${focus}`}>← Match history</Link>;
  if (phase !== "ready" || !match) return <>
    {back}
    <section aria-live="polite" className={`${panel} mt-4 p-6`}>
      {phase === "loading" ? <p className="text-sm text-zinc-500">Loading this debate…</p>
        : phase === "missing" ? <><h1 className="text-xl font-bold">Debate not found</h1><p className="mt-2 text-sm text-zinc-500">It may not be one of yours, or it may not have finished yet.</p></>
        : <p className="text-sm text-red-300">Couldn’t load this debate. <button type="button" onClick={() => setAttempt((value) => value + 1)} className={`underline ${focus}`}>Try again</button></p>}
    </section>
  </>;

  const change = eloChange(match);
  return <>
    {back}
    <section aria-labelledby="match-title" className={`${panel} mt-4 p-7`}>
      <div className="flex items-center gap-3">
        <h1 id="match-title" className="text-3xl font-black tracking-tight">{HEADING[match.outcome]}</h1>
        <span className={`rounded-full border px-3 py-1 text-xs font-bold ${OUTCOME_COLOR[match.outcome]}`}>{OUTCOME_LABEL[match.outcome]}</span>
        {change !== null && <span className="text-sm font-semibold tabular-nums text-zinc-300">{formatEloChange(change)}</span>}
      </div>
      <p className="mt-3 text-lg font-semibold">{match.topic ?? "Topic removed"}</p>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm xl:grid-cols-4">
        <div><dt className="text-[10px] uppercase tracking-widest text-zinc-500">Opponent</dt><dd className="mt-0.5 truncate">{opponentName(match)}</dd></div>
        <div><dt className="text-[10px] uppercase tracking-widest text-zinc-500">Your model</dt><dd className="mt-0.5 truncate">{modelLabel(match)}</dd></div>
        <div><dt className="text-[10px] uppercase tracking-widest text-zinc-500">Played</dt><dd className="mt-0.5 truncate">{new Date(match.ended_at).toLocaleString()}</dd></div>
        <div><dt className="text-[10px] uppercase tracking-widest text-zinc-500">Ended</dt><dd className="mt-0.5">{endReasonLabel(match)}</dd></div>
      </dl>
      {match.verdict_reasoning && <div className="mt-5 border-t border-white/[0.07] pt-4">
        <h2 className="text-xs font-bold">{match.end_reason === "judged" ? "The judge’s verdict" : "Why it ended"}</h2>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-300">{match.verdict_reasoning}</p>
      </div>}
    </section>
    {match.turns.length === 0
      ? <p className={`${panel} mt-4 p-6 text-sm text-zinc-500`}>The arguments from this debate weren’t saved.</p>
      : <div className="mt-4 grid gap-4 lg:grid-cols-2"><Argument match={match} side="pro" /><Argument match={match} side="con" /></div>}
  </>;
}
