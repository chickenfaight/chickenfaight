import type { Arena } from "./protocol";

// The arena last chosen in the lobby, remembered in this browser so other pages (tips) default to it.
// Storage can be unavailable (private mode, blocked site data), so every access is guarded.
const KEY = "chickenfaight.selected-arena";

export function saveSelectedArena(id: string): void {
  try { localStorage.setItem(KEY, id); } catch { /* not remembered; harmless */ }
}

// The remembered arena if it's still offered, else the first playable one.
export function preferredArena(arenas: Arena[], current = ""): string {
  let stored: string | null = null;
  try { stored = localStorage.getItem(KEY); } catch { /* fall through */ }
  const playable = (id: string | null) => arenas.some((arena) => arena.id === id && arena.kind === "provided");
  if (playable(current)) return current;
  if (playable(stored)) return stored!;
  return arenas.find((arena) => arena.kind === "provided")?.id ?? "";
}
