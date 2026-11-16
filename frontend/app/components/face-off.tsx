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

// One corner of the face-off. `align` mirrors the right-hand player.
function Corner({ player, align, size, motion, delay }: { player: FaceOffPlayer; align: "left" | "right"; size: "lg" | "md"; motion: boolean; delay: number }) {
  const right = align === "right";
  const change = player.elo !== null && player.eloAfter != null ? player.eloAfter - player.elo : null;
  return (
    <div className={`flex min-w-0 items-center gap-4 ${right ? "flex-row-reverse text-right" : ""} ${motion ? (right ? "animate-enter-right" : "animate-enter-left") : ""}`} style={motion ? { animationDelay: `${delay}ms` } : undefined}>
      <Avatar name={player.name} url={player.avatarUrl} size={size === "lg" ? 84 : 52} ring={`border-2 ${SIDE_BORDER[player.side]}`} />
      <div className="min-w-0">
        <p className="eyebrow">{player.you ? "You" : "Opponent"}{player.winner && <span className="ml-2 text-gold">Winner</span>}</p>
        <p className={`mt-1 truncate font-bold ${size === "lg" ? "text-2xl" : "text-lg"}`}>{player.name}</p>
        <p className={`mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 ${right ? "justify-end" : ""}`}>
          <span className={`stat rounded-control border px-2 py-0.5 text-sm uppercase tracking-wider ${SIDE_TEXT[player.side]} ${SIDE_BORDER[player.side]}`}>{SIDE_LABEL[player.side]}</span>
          {player.elo !== null && (change === null
            ? <span className="text-sm text-ink-muted"><span className={`stat text-ink ${size === "lg" ? "text-2xl" : "text-xl"}`}>{player.elo}</span> Elo</span>
            : <span className="text-sm text-ink-muted">
                <span className="stat text-xl text-ink">
                  <CountUp from={player.elo} to={player.eloAfter!} delay={motion ? delay + 300 : 0} />
                </span> Elo{" "}
                <CountUp from={0} to={change} delay={motion ? delay + 300 : 0} format={signed} className={`stat text-lg ${eloChangeColor(change)}`} />
              </span>)}
        </p>
      </div>
    </div>
  );
}

// Both players and their sides, "you" on the left. `motion` slides each corner in (the arena intro);
// with Elo after the match it counts to the new rating.
export default function FaceOff({ you, opponent, size = "md", motion = false, delay = 0, label = "The matchup" }: {
  you: FaceOffPlayer; opponent: FaceOffPlayer; size?: "lg" | "md"; motion?: boolean; delay?: number; label?: string;
}) {
  return (
    <section aria-label={label} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 sm:gap-8">
      <Corner player={you} align="left" size={size} motion={motion} delay={delay} />
      <span aria-hidden="true" className={`headline text-accent ${size === "lg" ? "text-6xl" : "text-3xl"} ${motion ? "animate-stamp" : ""}`} style={motion ? { animationDelay: `${delay + 260}ms` } : undefined}>vs</span>
      <Corner player={opponent} align="right" size={size} motion={motion} delay={delay + 80} />
    </section>
  );
}
