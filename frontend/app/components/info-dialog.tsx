"use client";

import { useEffect, useId, useRef } from "react";
import Icon from "./line-icon";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";

const details = {
  "How to play": { intro: "Your words. Your strategy. Your AI.", items: ["Choose a model and join its matchmaking queue.", "Once matched, you’ll enter a separate debate page and write one prompt to guide your AI.", "Watch both AIs debate through opening, rebuttal, and closing arguments.", "An AI judge picks the winner. Your rating belongs to that model’s ladder."] },
  "Your ladder": { intro: "A fresh climb with every model.", items: ["Each model has its own Elo ladder, so your results are compared on equal footing.", "The rating and results shown here are sample data. Per-model rankings and match history are coming soon."] },
  "Bring your own model": { intro: "Homegrown intelligence. Same arena.", items: ["The planned BYOM arena connects a model on your machine through BILC, the BYOM Interface Layer Client.", "Device pairing and the BYOM ladder are coming soon."] },
} satisfies Record<string, { intro: string; items: string[] }>;

export type DetailTitle = keyof typeof details;

// Modal explaining a lobby feature; open while `title` is set. Closing (button or Escape) calls `onClose`.
export default function InfoDialog({ title, onClose }: { title: DetailTitle | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const shown = title ?? "How to play";

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (title && !element.open) element.showModal();
    else if (!title && element.open) element.close();
  }, [title]);

  return (
      <dialog ref={dialog} onClose={onClose} aria-labelledby={titleId} className="fixed inset-0 m-auto w-[min(520px,90vw)] rounded-3xl border border-white/10 bg-[#202124] p-8 text-[#f5f3ef] backdrop:bg-black/70">
      <div className="flex items-center justify-between gap-4"><h2 id={titleId} className="text-xl font-bold">{shown}</h2><button autoFocus onClick={() => dialog.current?.close()} aria-label="Close" className={`rounded-xl p-2 hover:bg-white/5 ${focus}`}><Icon name="cross" /></button></div>
      <p className="mt-3 text-sm text-[#ff7882]">{details[shown].intro}</p><ol className="mt-6 space-y-4">{details[shown].items.map((item, i) => <li key={item} className="flex gap-3 text-sm leading-relaxed text-zinc-300"><span className="font-mono text-zinc-500">0{i + 1}</span>{item}</li>)}</ol>
    </dialog>
  );
}
