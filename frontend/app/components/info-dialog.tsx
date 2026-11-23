"use client";

import { JUDGE_RUBRIC } from "../lib/judge-rubric";
import { JUDGE_CATEGORIES, MAX_CATEGORY_SCORE, MAX_TOTAL_SCORE } from "../lib/protocol";
import Modal from "./modal";

const details = {
  "How to play": [
    "Use Quick Queue or choose a specific model to find a debate.",
    "Pick Pro or Con. The first pick locks both sides. Write one strategy prompt before the timer ends.",
    "Watch your AI make its opening argument, then see how the judge scored both sides. Each model has its own rating.",
  ],
  "Bring your own model": [
    "Connect a model running on your computer through BILC, the BYOM Interface Layer Client.",
    "Open Local models in the navigation to pair a device.",
  ],
} satisfies Record<string, string[]>;

export type DetailTitle = keyof typeof details;

// Modal explaining a lobby feature; open while `title` is set. Closing (button or Escape) calls `onClose`.
export default function InfoDialog({ title, onClose }: { title: DetailTitle | null; onClose: () => void }) {
  const shown = title ?? "How to play";
  return (
    <Modal open={title !== null} title={shown} onClose={onClose} closable>
      <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-relaxed text-ink-muted marker:font-semibold marker:text-accent-ink">
        {details[shown].map((item) => <li key={item} className="pl-1">{item}</li>)}
      </ol>
      {shown === "How to play" && <section aria-labelledby="how-to-play-scoring" className="mt-5 border-t border-line pt-5">
        <h3 id="how-to-play-scoring" className="text-base font-semibold">How the judge scores</h3>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          The judge gives each opening 0–{MAX_CATEGORY_SCORE} points per category. The higher total out of {MAX_TOTAL_SCORE} wins. If totals tie, the judge picks a winner and explains the deciding difference.
        </p>
        <dl className="mt-4 space-y-3 text-sm leading-relaxed">
          {JUDGE_CATEGORIES.map(category => {
            const { label, description } = JUDGE_RUBRIC[category];
            return <div key={category}>
              <dt className="font-semibold">{label}</dt>
              <dd className="text-ink-muted">{description}</dd>
            </div>;
          })}
        </dl>
      </section>}
    </Modal>
  );
}
