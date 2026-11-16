"use client";

import Modal from "./modal";

const details = {
  "How to play": { intro: "Your words. Your strategy. Your AI.", items: ["Choose a model and join its matchmaking queue.", "Once matched, you’ll enter a separate debate page and write one prompt to guide your AI.", "Watch both AIs debate through opening, rebuttal, and closing arguments.", "An AI judge picks the winner. Your rating belongs to that model’s ladder."] },
  "Bring your own model": { intro: "Homegrown intelligence. Same arena.", items: ["The BYOM arena connects a model on your machine through BILC, the BYOM Interface Layer Client.", "Device pairing is easy and can be found on the left sidebar."] },
} satisfies Record<string, { intro: string; items: string[] }>;

export type DetailTitle = keyof typeof details;

// Modal explaining a lobby feature; open while `title` is set. Closing (button or Escape) calls `onClose`.
export default function InfoDialog({ title, onClose }: { title: DetailTitle | null; onClose: () => void }) {
  const shown = title ?? "How to play";
  return (
    <Modal open={title !== null} title={shown} onClose={onClose} closable>
      <p className="mt-2 text-sm text-accent-ink">{details[shown].intro}</p>
      <ol className="mt-6 space-y-4">{details[shown].items.map((item, i) => <li key={item} className="flex gap-4 text-sm leading-relaxed text-ink-muted"><span className="stat w-6 shrink-0 text-lg text-ink-faint">0{i + 1}</span>{item}</li>)}</ol>
    </Modal>
  );
}
