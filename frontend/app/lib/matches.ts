import { displayName, type MatchOutcome, type MatchSummary } from "./protocol";

export const OUTCOME_LABEL: Record<MatchOutcome, string> = { win: "Win", loss: "Loss", void: "Void" };
export const OUTCOME_COLOR: Record<MatchOutcome, string> = {
  win: "border-emerald-400/40 text-emerald-400",
  loss: "border-red-400/40 text-red-300",
  void: "border-white/15 text-zinc-400",
};

const END_REASON: Record<string, string> = {
  judged: "Decided by the judge",
  no_show: "A player didn’t show up",
  no_prompt: "A player didn’t submit a prompt in time",
  resigned: "A player left the debate",
  model_failure: "A model failed to respond",
  judge_failure: "The judge failed to return a verdict",
};

export function endReasonLabel(match: MatchSummary): string {
  return END_REASON[match.end_reason] ?? "The debate ended";
}

export function modelLabel(match: MatchSummary): string {
  return match.model ?? "Model not recorded";
}

export function opponentName(match: MatchSummary): string {
  const opponent = match.participants.find((participant) => participant.side !== match.you);
  return opponent?.user ? displayName(opponent.user) : "Deleted player";
}

// The caller's Elo change, or null when the match didn't change it (forfeits, voids, older matches).
export function eloChange(match: MatchSummary): number | null {
  const you = match.participants.find((participant) => participant.side === match.you);
  return you && you.elo_before !== null && you.elo_after !== null ? you.elo_after - you.elo_before : null;
}

export function formatEloChange(change: number): string {
  return `${change > 0 ? "+" : change < 0 ? "−" : "±"}${Math.abs(change)} Elo`;
}
