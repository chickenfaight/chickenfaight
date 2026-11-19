import { SIDE_BORDER, SIDE_LABEL, SIDE_TEXT, eloChangeColor, signed } from "../lib/matches";
import type { Side } from "../lib/protocol";
import Avatar from "./avatar";
import CountUp from "./count-up";

export type FaceOffPlayer = {
  side: Side;
  name: string;
  tag: string | null;
  avatarUrl: string | null;
  you: boolean;
  // Elo going in, and after the match once a result changed it.
  elo: number | null;
  eloAfter?: number | null;
  winner?: boolean;
};

type Presentation = "compact" | "intro";

// One corner of the face-off. `align` mirrors the right-hand player.
function Corner({ player, align, presentation }: { player: FaceOffPlayer; align: "left" | "right"; presentation?: Presentation }) {
  const right = align === "right";
  const compact = presentation === "compact";
  const intro = presentation === "intro";
  const change = player.elo !== null && player.eloAfter != null ? player.eloAfter - player.elo : null;
  const layout = intro
    ? `flex-col gap-2 text-center animate-match-corner sm:gap-5 ${right ? "[--match-entry-offset:32px] sm:flex-row-reverse sm:text-right" : "[--match-entry-offset:-32px] sm:flex-row sm:text-left"}`
    : `${compact ? "gap-2" : "gap-3 sm:gap-4"} ${right ? "flex-row-reverse text-right" : ""}`;
  const statsAlignment = intro ? `justify-center ${right ? "sm:justify-end" : "sm:justify-start"}` : right ? "justify-end" : "";
  return (
    <div className={`flex min-w-0 items-center ${layout}`}>
      <Avatar name={player.name} url={player.avatarUrl} size={intro ? 64 : compact ? 32 : 52} ring={`border-2 ${SIDE_BORDER[player.side]}`} />
      <div className="min-w-0">
        {!compact && <p className="eyebrow">{player.you ? "You" : "Opponent"}{player.winner && <span className="ml-2 text-gold">Winner</span>}</p>}
        <p className={`font-bold ${intro ? "mt-1 wrap-anywhere text-lg sm:text-xl" : compact ? "truncate text-sm" : "mt-1 truncate text-lg"}`} title={player.name}>{player.name}</p>
        {compact ? <p className="mt-0.5 text-xs text-ink-muted">{player.you ? "You" : "Opponent"}{player.elo !== null && <> · {player.elo} Elo</>}</p> :
        <p className={`mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 ${statsAlignment}`}>
          <span className={`stat rounded-control border px-2 py-0.5 text-sm uppercase tracking-wider ${SIDE_TEXT[player.side]} ${SIDE_BORDER[player.side]}`}>{SIDE_LABEL[player.side]}</span>
          {player.elo !== null && (change === null
            ? <span className="text-sm text-ink-muted"><span className="stat text-xl text-ink">{player.elo}</span> Elo</span>
            : <span className="text-sm text-ink-muted">
                <span className="stat text-xl text-ink">
                  <CountUp from={player.elo} to={player.eloAfter!} />
                </span> Elo{" "}
                <CountUp from={0} to={change} format={signed} className={`stat text-lg ${eloChangeColor(change)}`} />
              </span>)}
        </p>}
      </div>
    </div>
  );
}

// Both players, with "you" on the left. The prompt view shows the assigned side beside the deadline.
export default function FaceOff({ you, opponent, presentation, label = "The matchup" }: {
  you: FaceOffPlayer; opponent: FaceOffPlayer; presentation?: Presentation; label?: string;
}) {
  return (
    <section aria-label={label} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 sm:gap-8">
      <Corner player={you} align="left" presentation={presentation} />
      <span aria-hidden="true" className={`headline text-accent ${presentation === "intro" ? "text-4xl sm:text-5xl" : presentation === "compact" ? "text-xl" : "text-3xl"}`}>vs</span>
      <Corner player={opponent} align="right" presentation={presentation} />
    </section>
  );
}
