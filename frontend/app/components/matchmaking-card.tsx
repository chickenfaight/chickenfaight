"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { parseArenas, parseBilcDevices, SIZE_CLASS_LABELS, type Arena, type BilcDevice } from "../lib/protocol";
import { preferredArena, savedArena, saveSelectedArena } from "../lib/selected-arena";
import Button, { buttonClass } from "./button";
import ModelPicker from "./model-picker";
import { queueName, showQueueIndicator, useQueue } from "./providers/queue-provider";
import { QueueElapsed } from "./queue-status-indicator";

// `daily` joins today's daily-challenge queue for the chosen model instead of a regular match.
export default function MatchmakingCard({ daily = false, onChallengeDone }: { daily?: boolean; onChallengeDone?: () => void }) {
  const queueState = useQueue();
  const { phase, queue, error, join, cancel, retry } = queueState;
  const [arenas, setArenas] = useState<Arena[]>([]);
  const [catalogPhase, setCatalogPhase] = useState<"loading" | "ready" | "error" | "signed-out">("loading");
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  // The BYOM arena plays with one of the player's own BILC devices.
  const [devices, setDevices] = useState<BilcDevice[] | null>(null);
  const [devicesError, setDevicesError] = useState(false);
  const [devicesAttempt, setDevicesAttempt] = useState(0);
  const [deviceId, setDeviceId] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const list = parseArenas(await api("/v1/arenas", controller.signal));
        if (controller.signal.aborted) return;
        if (!daily && list.some(arena => arena.kind === "provided")) list.unshift({ id: "quick", display_name: "Quick Queue", kind: "provided" });
        setArenas(list);
        setSelectedId(previous => {
          const remembered = previous || savedArena();
          return !daily && list.some(arena => arena.id === remembered) ? remembered! : preferredArena(list, previous);
        });
        setCatalogPhase("ready");
      } catch (err) {
        if (controller.signal.aborted) return;
        setCatalogPhase(err instanceof ApiError && err.status === 401 ? "signed-out" : "error");
      }
    }
    void load();
    return () => controller.abort();
  }, [catalogAttempt, daily]);

  const byomSelected = !daily && arenas.some(arena => arena.id === selectedId && arena.kind === "byom");
  useEffect(() => {
    if (!byomSelected) return;
    const controller = new AbortController();
    api("/v1/bilc/devices", controller.signal).then(data => {
      const list = parseBilcDevices(data);
      if (controller.signal.aborted) return;
      setDevices(list);
      setDevicesError(false);
      setDeviceId(previous => list.some(device => device.id === previous && device.status === "idle") ? previous : list.find(device => device.status === "idle")?.id ?? "");
    }).catch(() => {
      if (!controller.signal.aborted) setDevicesError(true);
    });
    return () => controller.abort();
  }, [byomSelected, devicesAttempt]);

  function refreshDevices() {
    setDevicesAttempt(value => value + 1);
  }

  function refreshArenas() {
    setCatalogPhase("loading");
    setCatalogAttempt(value => value + 1);
  }

  async function joinSelectedArena() {
    const arena = arenas.find(candidate => candidate.id === selectedId);
    if (!arena || (arena.kind === "byom" && !deviceReady)) return;
    const failure = await join(arena, daily, deviceId);
    if (failure === "device") refreshDevices();
    if (failure === "arena") {
      setSelectedId("");
      refreshArenas();
    }
    if (failure === "challenge") onChallengeDone?.();
  }

  // The shared header takes over once a queue starts on the challenge page.
  if (daily && showQueueIndicator(queueState)) return null;
  if (phase === "finishing") return <div className="panel p-panel">
    <p className="text-base font-bold" role="status">Waiting for your previous debate to end…</p>
    <p className="mt-2 text-sm text-ink-muted">You can join a new queue once the debate ends.</p>
  </div>;

  const queued = phase === "queued";
  const deviceReady = devices?.some(device => device.id === deviceId && device.status === "idle") ?? false;
  const canJoin = catalogPhase === "ready" && arenas.some(arena => arena.id === selectedId && (arena.kind === "provided" || (byomSelected && deviceReady)));
  // The daily challenge is played on the provided models only.
  const listed = daily ? arenas.filter(arena => arena.kind === "provided") : arenas;
  const selectionLocked = phase !== "idle" || catalogPhase !== "ready";
  const showQueue = queue !== null || phase === "matched";
  const signedOut = phase === "signed-out" || catalogPhase === "signed-out";
  const waiting = queued || phase === "joining" || phase === "checking" || phase === "cancelling";
  const buttonDisabled = (waiting && !queued) || (!queued && !canJoin);
  const title = {
    checking: "Checking queue…", idle: daily ? "Ready for today’s challenge?" : "Choose your arena", joining: "Joining queue…",
    cancelling: "Leaving queue…", queued: "Finding an opponent…", matched: "Opponent found!", error: "Queue status unavailable", "signed-out": "Join the debate",
  }[phase];

  const select = "h-12 w-full rounded-control border border-line-strong bg-inset px-3 text-sm text-ink transition-colors duration-(--duration-fast) hover:border-ink-faint disabled:text-ink-muted disabled:hover:border-line-strong focus-ring";
  const smallLink = "font-semibold text-accent-ink underline underline-offset-2 focus-ring";
  return <div className={`min-w-0 rounded-panel border p-panel shadow-raised transition-[border-color,background-color] duration-(--duration-slow) ${queued ? "border-accent/40 bg-accent-wash" : "border-line bg-inset/60"}`}>
    <div className="mb-5 flex min-h-8 items-center gap-3">
      {waiting && <span aria-hidden="true" className="h-7 w-7 shrink-0 rounded-full border-[3px] border-accent/20 border-t-accent motion-safe:animate-spin" />}
      <h2 className={`text-base font-bold ${queued ? "text-accent-ink" : "text-ink"}`}>{title}</h2>
    </div>
    <span role="status" className="sr-only">{phase === "idle" ? "" : title}</span>
    {!daily && !showQueue && <div role="group" aria-label="Model source" className="mb-5 flex flex-wrap gap-2">
      <Button size="sm" variant={!byomSelected ? "secondary" : "ghost"} aria-pressed={!byomSelected} aria-disabled={selectionLocked} onClick={() => { if (!selectionLocked && byomSelected) { const id = arenas.find(arena => arena.kind === "provided")?.id ?? ""; setSelectedId(id); saveSelectedArena(id); } }}>Provided models</Button>
      <Button size="sm" variant={byomSelected ? "secondary" : "ghost"} aria-pressed={byomSelected} aria-disabled={selectionLocked || !arenas.some(arena => arena.kind === "byom")} onClick={() => { if (!selectionLocked) { const id = arenas.find(arena => arena.kind === "byom")?.id; if (id) { setSelectedId(id); saveSelectedArena(id); } } }}>Bring your own model</Button>
    </div>}
    {byomSelected && !showQueue ? <p className="mb-3 text-sm text-ink-muted">Play using a model on your computer. Each player connects their own device.</p> : <ModelPicker
      arenas={listed.filter(arena => arena.kind === "provided")}
      value={selectedId} locked={selectionLocked}
      queueLabel={queue ? queueName(queue) : undefined}
      placeholder={signedOut ? "Sign in to choose an arena" : catalogPhase === "loading" ? "Loading arenas…" : "Choose an arena"}
      onChange={id => { setSelectedId(id); saveSelectedArena(id); }}
    />}
    <div aria-live="polite" className="mt-2 text-xs text-ink-muted">
      {catalogPhase === "loading" && <p>Loading arenas…</p>}
      {catalogPhase === "error" && <p className="text-danger">Couldn’t load arenas. <button type="button" onClick={refreshArenas} className={smallLink}>Retry arenas</button></p>}
      {catalogPhase === "ready" && !arenas.some(arena => arena.kind === "provided") && <p>No arenas available yet. <button type="button" onClick={refreshArenas} className={smallLink}>Refresh arenas</button></p>}
      {signedOut && <p>Sign in to choose an arena.</p>}
      {queue?.mode === null && <p>Your queue’s model will be shown when the debate starts.</p>}
    </div>
    {byomSelected && !showQueue && <>
      <label htmlFor="queue-device" className="eyebrow mb-2 mt-3 block">Your device</label>
      <select id="queue-device" autoComplete="off" value={deviceId} onChange={event => setDeviceId(event.target.value)} disabled={selectionLocked || !devices?.length} className={select}>
        {devices === null ? <option value="">{devicesError ? "Couldn’t load devices" : "Loading devices…"}</option>
          : devices.length === 0 ? <option value="">No paired devices</option>
          : <>
              {!deviceId && <option value="">No device online</option>}
              {devices.map(device => <option key={device.id} value={device.id} disabled={device.status !== "idle"}>
                {device.name} · {device.model_name ?? "no model yet"}{device.size_class ? ` · ${SIZE_CLASS_LABELS[device.size_class]}` : ""}{device.status !== "idle" ? ` (${device.status})` : ""}
              </option>)}
            </>}
      </select>
      <div aria-live="polite" className="mt-2 text-xs text-ink-muted">
        {devicesError ? <p className="text-danger">Couldn’t load your devices. <button type="button" onClick={refreshDevices} className={smallLink}>Retry</button></p>
          : devices?.length === 0 ? <p>Pair a computer running your model. <Link href="/bilc" className={smallLink}>Connect a device</Link>.</p>
          : devices && !deviceReady ? <p>None of your devices is online. Run <span className="font-mono">bilc run</span> on one, then <button type="button" onClick={refreshDevices} className={smallLink}>refresh</button>.</p>
          : null}
      </div>
    </>}
    <div className="flex min-h-12 items-center justify-between gap-2 text-xs text-ink-faint">
      <span>{queue ? "Time in queue" : showQueue ? "Your arena will be confirmed when the debate starts." : byomSelected ? "Paired with models of a similar size" : selectedId === "quick" ? "Quick Queue finds an available cloud arena for you." : "Both players debate using the same model."}</span>
      {queue && phase !== "matched" && <QueueElapsed since={queue.elapsedSince} className="stat text-2xl text-accent-ink" />}
    </div>
    {phase === "matched" ? <p role="status" className="py-3 text-sm font-semibold text-accent-ink">Opponent found. Entering the arena…</p>
      : signedOut && !queue ? <Link href="/login" className={buttonClass("primary", "lg", "w-full")}>Sign in to queue</Link>
      : phase === "error" ? <div className="flex flex-wrap gap-2"><Button variant="primary" size="lg" className="flex-1" onClick={retry}>Retry queue status</Button>{queue && <Button size="lg" onClick={cancel}>Cancel queue</Button>}</div>
      // Firefox restores native disabled state on reload, which can break hydration.
      : <Button variant={queued ? "secondary" : "primary"} size="lg" className="w-full" aria-disabled={buttonDisabled} onClick={() => { if (!buttonDisabled) { if (queued) cancel(); else void joinSelectedArena(); } }}>{queued ? "Cancel queue" : phase === "cancelling" ? "Cancelling…" : phase === "checking" ? "Checking…" : phase === "joining" ? "Joining…" : "Find match"}</Button>}
    {error && <p role="alert" className="mt-3 text-xs leading-relaxed text-danger">{error}</p>}
    <p className="mt-3 text-center text-xs leading-relaxed text-ink-faint">{phase === "matched" ? "Your debate is ready." : queued ? "You can leave the queue anytime before an opponent is found." : byomSelected ? deviceReady ? "Your device is ready." : "Connect an online device to find a match." : "Write one prompt. Your AI debates. The judge decides."}</p>
  </div>;
}
