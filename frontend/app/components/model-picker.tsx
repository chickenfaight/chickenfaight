"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import type { Arena } from "../lib/protocol";
import Icon from "./line-icon";
import { modelBrand } from "../lib/model-brand";
import Image from "next/image";

function ModelLogo({ arena }: { arena: Arena }) {
  const brand = modelBrand(arena);
  return <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-line bg-inset">
    {brand ? <Image src={`/model-logos/${brand.logo}.svg`} alt="" width={22} height={22} unoptimized className={`h-5 w-5 ${["openai", "anthropic", "grok"].includes(brand.logo) ? "brightness-0 invert" : ""}`} />
      : <Icon name={arena.id === "quick" ? "bolt" : "chip"} className="h-5 w-5 text-ink-muted" />}
  </span>;
}

function modelLabel(arena: Arena) {
  const parts = arena.display_name.split(": ");
  const brand = modelBrand(arena);
  const author = parts.length > 1 ? parts[0] : brand?.name ?? "Cloud model";
  return { name: parts.length > 1 ? parts.slice(1).join(": ") : arena.display_name,
    detail: arena.id === "quick" ? "Find an available cloud arena" : author };
}

export default function ModelPicker({ arenas, value, locked, queueLabel, placeholder, onChange }: {
  arenas: Arena[]; value: string; locked: boolean; queueLabel?: string; placeholder: string; onChange: (id: string) => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = arenas.find(arena => arena.id === value);
  const label = selected && modelLabel(selected);
  const prefix = useRef("");
  const typedAt = useRef(0);

  function move(index: number) {
    const next = Math.max(0, Math.min(arenas.length - 1, index));
    setActive(next);
    document.getElementById(`${id}-${next}`)?.scrollIntoView({ block: "nearest" });
  }
  function show() {
    if (locked || !arenas.length) return;
    const anchor = trigger.current!.getBoundingClientRect();
    const element = popup.current!;
    element.style.left = `${anchor.left}px`;
    element.style.width = `${anchor.width}px`;
    const below = window.innerHeight - anchor.bottom - 12;
    const above = anchor.top - 12;
    element.style.maxHeight = `${Math.min(360, Math.max(below, above))}px`;
    element.style.top = below >= Math.min(360, above) ? `${anchor.bottom + 6}px` : "auto";
    element.style.bottom = below >= Math.min(360, above) ? "auto" : `${window.innerHeight - anchor.top + 6}px`;
    setActive(Math.max(0, arenas.findIndex(arena => arena.id === value)));
    element.showPopover();
    setOpen(true);
  }
  function choose(index: number) {
    if (locked || !arenas[index]) return;
    onChange(arenas[index].id);
    popup.current?.hidePopover();
    trigger.current?.focus();
  }
  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (locked) return;
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (!open) { show(); if (event.key === "Home" || event.key === "End") move(event.key === "Home" ? 0 : arenas.length - 1); }
      else move(event.key === "Home" ? 0 : event.key === "End" ? arenas.length - 1 : active + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(active); else show();
    } else if (event.key === "Escape" || event.key === "Tab") {
      popup.current?.hidePopover();
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      if (!open) show();
      prefix.current = Date.now() - typedAt.current > 700 ? event.key : prefix.current + event.key;
      typedAt.current = Date.now();
      const index = arenas.findIndex(arena => `${modelLabel(arena).name} ${modelLabel(arena).detail}`.toLowerCase().startsWith(prefix.current.toLowerCase()));
      if (index >= 0) move(index);
    }
  }

  return <div>
    <label id={`${id}-label`} htmlFor={`${id}-trigger`} className="eyebrow mb-2 block">AI model</label>
    <button ref={trigger} id={`${id}-trigger`} type="button" role="combobox" aria-labelledby={`${id}-label`}
      aria-haspopup="listbox" aria-controls={id} aria-expanded={open} aria-disabled={locked}
      aria-activedescendant={open ? `${id}-${active}` : undefined} data-value={value}
      onKeyDown={keyDown} onClick={() => { if (open) popup.current?.hidePopover(); else show(); }}
      className="focus-ring flex min-h-20 w-full items-center justify-between gap-3 rounded-control border border-line-strong bg-inset px-4 py-3 text-left transition-colors hover:border-ink-faint aria-disabled:opacity-60">
      {!queueLabel && selected && <ModelLogo arena={selected} />}
      <span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold">{queueLabel ?? label?.name ?? placeholder}</span>
        {!queueLabel && label && <span className="mt-1 block text-xs text-ink-muted">{label.detail}</span>}</span>
      <Icon name="chevron" className="h-4 w-4 shrink-0 text-ink-muted" />
    </button>
    <div ref={popup} id={id} popover="auto" role="listbox" aria-labelledby={`${id}-label`}
      onToggle={event => setOpen(event.newState === "open")}
      onBeforeToggle={event => { if (event.newState === "open") requestAnimationFrame(() => document.getElementById(`${id}-${Math.max(0, arenas.findIndex(arena => arena.id === value))}`)?.scrollIntoView({ block: "nearest" })); }}
      className="fixed inset-auto m-0 overflow-y-auto overscroll-contain rounded-control border border-line-strong bg-surface p-1.5 text-ink shadow-overlay">
      {arenas.map((arena, index) => {
        const item = modelLabel(arena);
        return <div key={arena.id} id={`${id}-${index}`} role="option" aria-label={arena.display_name} aria-selected={arena.id === value} data-value={arena.id}
          onPointerMove={event => { if (event.movementX || event.movementY) setActive(index); }} onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}
          className={`flex cursor-pointer items-center justify-between gap-4 rounded-control px-3 py-3 ${index === active ? "bg-surface-raised outline outline-1 -outline-offset-1 outline-line-strong" : ""} ${arena.id === value ? "text-accent-ink" : ""}`}>
          <ModelLogo arena={arena} />
          <span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold">{item.name}</span><span className="mt-1 block text-xs text-ink-muted">{item.detail}</span></span>
          {arena.id === value && <span className="text-xs font-semibold">Selected</span>}
        </div>;
      })}
    </div>
  </div>;
}
