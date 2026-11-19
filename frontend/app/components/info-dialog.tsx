"use client";

import Modal from "./modal";

const details = {
  "How to play": [
    "Use Quick Queue to find a debate or pick a specific model.",
    "When you’re matched, read your assigned side and submit one strategy prompt before the timer runs out.",
    "Watch your AI write one opening argument. The judge compares it with your opponent’s opening argument.",
    "Read the verdict and both arguments. Each model has its own rating.",
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
    </Modal>
  );
}
