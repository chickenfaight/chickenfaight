"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import Icon from "./line-icon";

type Props = {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  // While busy, Escape can't close it (a request is running). Blocking never closes on Escape.
  busy?: boolean;
  blocking?: boolean;
  // Show an × button in the corner.
  closable?: boolean;
  eyebrow?: ReactNode;
  description?: ReactNode;
  width?: "sm" | "md";
};

// The app's one modal, on the native <dialog>: focus is trapped and restored by the browser, and the
// backdrop and top layer come for free. Open while `open` is true; Escape or `close()` calls `onClose`.
export default function Modal({ open, title, onClose, children, busy = false, blocking = false, closable = false, eyebrow, description, width = "md" }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => { if (busy || blocking) event.preventDefault(); }}
      onClose={onClose}
      className={`fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-panel border border-line-strong bg-surface p-panel text-ink shadow-overlay open:animate-pop backdrop:animate-fade ${width === "sm" ? "w-[min(440px,calc(100vw-2rem))]" : "w-[min(520px,calc(100vw-2rem))]"}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow mb-2 text-accent-ink">{eyebrow}</p>}
          <h2 id={titleId} className="text-xl font-bold tracking-tight">{title}</h2>
        </div>
        {closable && <button type="button" autoFocus onClick={() => dialog.current?.close()} aria-label="Close"
          className="-m-1 shrink-0 rounded-control p-2 text-ink-muted transition-colors duration-(--duration-fast) hover:bg-white/[0.06] hover:text-ink focus-ring"><Icon name="cross" /></button>}
      </div>
      {description && <p id={descriptionId} className="mt-2 text-sm leading-relaxed text-ink-muted">{description}</p>}
      {open && children}
    </dialog>
  );
}
