"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

// A menu on the native popover: the button toggles it, Escape and clicking elsewhere close it (and
// return focus to the button), and with a mouse it also opens on hover. It sits under the button's
// right edge, placed when it opens.
export default function PopoverMenu({ button, buttonClassName = "", label, children, openOnHover = true, closeOnAction = false }: {
  button: ReactNode; buttonClassName?: string; label: string; children: ReactNode; openOnHover?: boolean; closeOnAction?: boolean;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  // Opened by hovering: the click that usually follows should keep it open, not toggle it shut.
  const hovered = useRef(false);

  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  function place() {
    const anchor = trigger.current?.getBoundingClientRect();
    const element = menu.current;
    if (!anchor || !element) return;
    const viewportGap = 8;
    const right = document.documentElement.clientWidth - anchor.right;
    element.style.top = `${anchor.bottom + viewportGap}px`;
    element.style.right = `clamp(${viewportGap}px, ${right}px, calc(100% - var(--popover-width) - ${viewportGap}px))`;
    element.style.maxHeight = `calc(100dvh - ${anchor.bottom + viewportGap * 2}px)`;
  }

  function show() {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    const element = menu.current;
    if (element && !element.matches(":popover-open")) {
      hovered.current = true;
      element.showPopover();
    }
  }

  function hideSoon() {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    // Long enough to cross the gap between the button and the menu.
    hideTimer.current = setTimeout(() => {
      const element = menu.current;
      if (element?.matches(":popover-open") && !element.contains(document.activeElement)) element.hidePopover();
    }, 160);
  }

  return (
    <div className="relative"
      onPointerEnter={(event) => { if (openOnHover && event.pointerType === "mouse") show(); }}
      onPointerLeave={(event) => { if (openOnHover && event.pointerType === "mouse") hideSoon(); }}>
      <button ref={trigger} type="button" popoverTarget={id} aria-expanded={open} aria-controls={id} className={buttonClassName}
        onClick={(event) => { if (hovered.current && open) { event.preventDefault(); hovered.current = false; } }}>
        {button}
      </button>
      <div ref={menu} id={id} popover="auto" aria-label={label}
        onBeforeToggle={(event) => { if (event.newState === "open") place(); }}
        onToggle={(event) => { setOpen(event.newState === "open"); if (event.newState === "closed") hovered.current = false; }}
        onClick={(event) => { if ((event.target as Element).closest(closeOnAction ? "a, button" : "a")) menu.current?.hidePopover(); }}
        className="fixed inset-auto m-0 w-(--popover-width) overflow-y-auto overscroll-contain rounded-panel border border-line-strong bg-surface p-2 text-sm text-ink shadow-overlay [--popover-width:14rem] [&:popover-open]:animate-pop">
        {children}
      </div>
    </div>
  );
}
