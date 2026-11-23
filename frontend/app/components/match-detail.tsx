"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { eloChange, eloChangeColor, endReasonLabel, formatEloChange, modelLabel, opponentName, otherSide, OUTCOME_COLOR, OUTCOME_LABEL, SIDE_LABEL, SIDE_TEXT } from "../lib/matches";
import { displayName, parseMatchDetail, type MatchDetail as Match, type Side } from "../lib/protocol";
import EmptyState from "./empty-state";
import ErrorState from "./error-state";
import FaceOff, { type FaceOffPlayer } from "./face-off";
import JudgeScorecard from "./judge-scorecard";
import Skeleton from "./skeleton";

const HEADING = { win: "You won.", loss: "You lost.", void: "Debate voided." };

function Argument({ match, side }: { match: Match; side: Side }) {
  const turn = match.turns.find((candidate) => candidate.side === side);
  const position = side === "pro" ? match.pro_position : match.con_position;
  return <section aria-label={`${SIDE_LABEL[side]} argument`} className="panel min-w-0 p-panel">
    <p className="wrap-anywhere text-xs font-bold uppercase tracking-wider"><span className={SIDE_TEXT[side]}>{SIDE_LABEL[side]}</span> <span className="text-ink-muted">· {side === match.you ? "You" : opponentName(match)}</span></p>
    {position && <p className="mt-1 wrap-anywhere text-xs text-ink-faint">{position}</p>}
    {/* Model output is untrusted: plain text only. */}
    {turn ? <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed">{turn.content}</p>
      : <p className="mt-4 text-sm text-ink-faint">No argument was generated.</p>}
    {turn?.truncated && <p className="mt-3 text-xs text-ink-faint">Cut off at the length limit.</p>}
  </section>;
}

function player(match: Match, side: Side): FaceOffPlayer {
  const participant = match.participants.find((candidate) => candidate.side === side);
  const user = participant?.user ?? null;
  return {
    side, you: side === match.you, name: user ? displayName(user) : "Deleted player", tag: user?.tag ?? null, avatarUrl: user?.avatar_url ?? null,
    elo: participant?.elo_before ?? null, eloAfter: participant?.elo_after ?? null, winner: match.winner_side === side,
  };
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

  const back = <Link href="/matches" className="rounded-control text-xs text-ink-muted transition-colors duration-(--duration-fast) hover:text-ink focus-ring">← Debate history</Link>;
  if (phase !== "ready" || !match) return <>
    {back}
    <div aria-live="polite" className="mt-4">
      {phase === "loading" ? <Skeleton label="Loading this debate…" variant="block" />
        : phase === "missing" ? <EmptyState title={<h1 className="headline text-3xl">Debate not found</h1>}>It may not be one of yours, or it may not have finished yet.</EmptyState>
        : <ErrorState message="Couldn’t load this debate." onRetry={() => setAttempt((value) => value + 1)} />}
    </div>
  </>;

  const change = eloChange(match);
  return <>
    {back}
    <section aria-labelledby="match-title" className="panel mt-4 min-w-0 p-panel">
      <div className="flex flex-wrap items-center gap-4">
        <h1 id="match-title" className="headline text-5xl">{HEADING[match.outcome]}</h1>
        <span className={`stat rounded-control border px-3 py-1 text-base uppercase ${OUTCOME_COLOR[match.outcome]}`}>{OUTCOME_LABEL[match.outcome]}</span>
        {change !== null && <span className={`stat text-2xl ${eloChangeColor(change)}`}>{formatEloChange(change)}</span>}
      </div>
      <p className="mt-3 wrap-anywhere text-lg font-semibold">{match.topic ?? "Topic removed"}</p>
      <div className="well mt-6 px-5 py-5"><FaceOff you={player(match, match.you)} opponent={player(match, otherSide(match.you))} label="Who debated" /></div>
      <dl className="mt-6 grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 xl:grid-cols-3">
        <div className="min-w-0"><dt className="eyebrow">Your model</dt><dd className="mt-1 wrap-anywhere">{modelLabel(match)}</dd></div>
        <div className="min-w-0"><dt className="eyebrow">Played</dt><dd className="mt-1"><time dateTime={match.ended_at}>{new Date(match.ended_at).toLocaleString()}</time></dd></div>
        <div className="min-w-0"><dt className="eyebrow">Ended</dt><dd className="mt-1">{endReasonLabel(match)}</dd></div>
      </dl>
      {match.scorecard && <JudgeScorecard scorecard={match.scorecard} you={match.you} />}
      {match.verdict_reasoning && <div className="mt-6 border-t border-line pt-5">
        <h2 className="text-sm font-bold">{match.end_reason === "judged" ? "The judge’s verdict" : "Why it ended"}</h2>
        <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-muted">{match.verdict_reasoning}</p>
      </div>}
    </section>
    {match.turns.length === 0
      ? <EmptyState className="mt-stack" title="The arguments from this debate weren’t saved." />
      : <div className="mt-stack grid gap-stack lg:grid-cols-2"><Argument match={match} side="pro" /><Argument match={match} side="con" /></div>}
  </>;
}
