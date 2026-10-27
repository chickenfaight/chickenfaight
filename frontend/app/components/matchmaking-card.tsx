"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { parseArenas, parseBilcDevices, parseQueueStatus, SIZE_CLASS_LABELS, type Arena, type BilcDevice } from "../lib/protocol";
import { preferredArena, saveSelectedArena } from "../lib/selected-arena";

type Phase = "checking" | "idle" | "joining" | "cancelling" | "queued" | "matched" | "error" | "signed-out";
const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";

// `daily` joins today's daily-challenge queue for the chosen model instead of a regular match.
export default function MatchmakingCard({ daily = false, onChallengeDone }: { daily?: boolean; onChallengeDone?: () => void }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [error, setError] = useState("");
  const router = useRouter();
  const [elapsed, setElapsed] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [arenas, setArenas] = useState<Arena[]>([]);
  const [catalogPhase, setCatalogPhase] = useState<"loading" | "ready" | "error" | "signed-out">("loading");
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  // The BYOM arena plays with one of the player's own BILC devices.
  const [devices, setDevices] = useState<BilcDevice[] | null>(null);
  const [devicesError, setDevicesError] = useState(false);
  const [devicesAttempt, setDevicesAttempt] = useState(0);
  const [deviceId, setDeviceId] = useState("");
  const joinDevice = useRef<string | null>(null);
  // A ref, so a new callback each render doesn't restart the queue effect.
  const challengeDone = useRef(onChallengeDone);
  useEffect(() => { challengeDone.current = onChallengeDone; });
  const [queuedModel, setQueuedModel] = useState<Arena | null>(null);
  const [queueActive, setQueueActive] = useState(false);
  const joinModel = useRef<Arena | null>(null);
  const action = useRef<"GET" | "POST" | "DELETE">("GET");
  const busy = useRef(false);
  const activeController = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const list = parseArenas(await api("/v1/arenas", controller.signal));
        if (controller.signal.aborted) return;
        setArenas(list);
        setSelectedId(previous => preferredArena(list, previous));
        setCatalogPhase("ready");
      } catch (err) {
        if (controller.signal.aborted) return;
        setCatalogPhase(err instanceof ApiError && err.status === 401 ? "signed-out" : "error");
      }
    }
    void load();
    return () => controller.abort();
  }, [catalogAttempt]);

  const byomSelected = !daily && arenas.some(arena => arena.id === selectedId && arena.kind === "byom");
  useEffect(() => {
    if (!byomSelected) return;
    const controller = new AbortController();
    api("/v1/bilc/devices", controller.signal).then(data => {
      const list = parseBilcDevices(data);
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

  useEffect(() => {
    const controller = new AbortController();
    activeController.current = controller;
    let timer: ReturnType<typeof setTimeout>;
    let method = action.current;
    action.current = "GET";
    let joining = method === "POST";

    async function poll() {
      try {
        let data: unknown;
        try {
          if (method === "POST") {
            // Recover an existing entry before attempting a new registration.
            data = await api("/v1/match/status", controller.signal);
            if (controller.signal.aborted) return;
            if (parseQueueStatus(data).status === "none") {
              const model = joinModel.current;
              if (!model) throw new Error("No arena selected");
              const body = daily ? { model_id: model.id, daily: true }
                : model.kind === "byom" ? { model_id: model.id, bilc_id: joinDevice.current } : { model_id: model.id };
              data = await api("/v1/match/queue", controller.signal, "POST", body);
              if (!controller.signal.aborted) setQueuedModel(model);
            } else {
              setQueuedModel(null);
            }
          } else {
            data = await api(method === "DELETE" ? "/v1/match/queue" : "/v1/match/status", controller.signal, method);
          }
          if (method === "DELETE") data = { status: "none" };
        } catch (err) {
          // A previous tab/request may already have registered this user.
          if (err instanceof ApiError && err.status === 409 && ["ALREADY_QUEUED", "IN_MATCH"].includes(err.code ?? "")) {
            setQueuedModel(null);
            data = await api("/v1/match/status", controller.signal);
          } else throw err;
        }
        if (controller.signal.aborted) return;
        const status = parseQueueStatus(data);
        setError("");
        if (status.status === "matched") {
          router.push(`/match/${encodeURIComponent(status.match_id)}`);
          setPhase("matched");
          busy.current = false;
          return;
        }
        if (status.status === "none") {
          setPhase("idle");
          setQueueActive(false);
          setQueuedModel(null);
          if (joining) {
            setError("The server reports no queue entry. You are not currently queued.");
          }
          busy.current = false;
          return;
        }
        setPhase("queued");
        setQueueActive(true);
        busy.current = false;
        method = "GET";
        joining = false;
        timer = setTimeout(poll, 1000);
      } catch (err) {
        if (controller.signal.aborted) return;
        busy.current = false;
        if (err instanceof ApiError && method === "POST" && joinModel.current?.kind === "byom"
          && (err.code === "BILC_OFFLINE" || err.code === "BILC_BUSY" || err.code === "NOT_FOUND")) {
          // The device went offline, got busy, or was revoked since the list loaded.
          setPhase("idle");
          setQueueActive(false);
          setQueuedModel(null);
          setError(err.code === "NOT_FOUND" ? "That device is no longer paired. Choose another one." : err.detail ?? "That device can’t play right now.");
          setDevicesAttempt(value => value + 1);
        } else if (err instanceof ApiError && err.status === 401) {
          setPhase("signed-out");
          setQueueActive(false);
          setQueuedModel(null);
          setError("Sign in to join the queue.");
        } else if (err instanceof ApiError && err.status === 404 && err.code === "NOT_FOUND" && method === "POST") {
          setPhase("idle");
          setQueueActive(false);
          setQueuedModel(null);
          setSelectedId("");
          setCatalogPhase("loading");
          setCatalogAttempt(value => value + 1);
          setError("That arena is no longer available. Choose an arena from the refreshed list.");
        } else if (err instanceof ApiError && err.code === "TAG_REQUIRED") {
          setPhase("idle");
          setError("Create your tag to join the queue.");
        } else if (err instanceof ApiError && err.code === "CHALLENGE_ALREADY_COMPLETED") {
          setPhase("idle");
          setError("You’ve already completed today’s challenge.");
          challengeDone.current?.();
        } else {
          setPhase("error");
          setError("Couldn’t confirm your queue status. Retry queue status; we’ll check for an existing game or queue entry first.");
        }
      }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [attempt, router, daily]);

  useEffect(() => {
    if (phase !== "queued") return;
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  function request(method: "GET" | "POST" | "DELETE") {
    if (busy.current) return;
    if (method === "POST") {
      const model = arenas.find(arena => arena.id === selectedId && (arena.kind === "provided" || (byomSelected && deviceReady)));
      if (catalogPhase !== "ready" || !model || phase !== "idle") return;
      joinModel.current = model;
      joinDevice.current = model.kind === "byom" ? deviceId : null;
      setQueuedModel(null);
    }
    busy.current = true;
    activeController.current?.abort();
    action.current = method;
    setError("");
    setElapsed(0);
    setPhase(method === "POST" ? "joining" : method === "DELETE" ? "cancelling" : "checking");
    setAttempt(value => value + 1);
  }

  const queued = phase === "queued";
  const deviceReady = devices?.some(device => device.id === deviceId && device.status === "idle") ?? false;
  const canJoin = catalogPhase === "ready" && arenas.some(arena => arena.id === selectedId && (arena.kind === "provided" || (byomSelected && deviceReady)));
  // The daily challenge is played on the provided models only.
  const listed = daily ? arenas.filter(arena => arena.kind === "provided") : arenas;
  const selectionLocked = phase !== "idle" || catalogPhase !== "ready";
  const showQueue = queueActive || phase === "matched";
  const signedOut = phase === "signed-out" || catalogPhase === "signed-out";
  const waiting = queued || phase === "joining" || phase === "checking" || phase === "cancelling";
  const buttonDisabled = (waiting && !queued) || (!queued && !canJoin);
  const title = {
    checking: "Checking queue…", idle: daily ? "Ready for today’s challenge?" : "Ready to ruffle feathers?", joining: "Joining queue…",
    cancelling: "Leaving queue…", queued: "Finding an opponent…", matched: "Opponent found!", error: "Queue status unavailable", "signed-out": "Join the debate",
  }[phase];

  return <div className={`min-w-0 rounded-3xl border p-4 xl:p-6 ${queued ? "border-[#f04b58]/35 bg-[#f04b58]/[0.035]" : "border-white/[0.08] bg-[#191a1d]"}`}>
    <div className="mb-5 flex items-center gap-3" role="status">
      {waiting && <span aria-hidden="true" className="h-8 w-8 shrink-0 rounded-full border-[3px] border-[#f04b58]/20 border-t-[#f04b58] motion-safe:animate-spin" />}
      <h3 className={`text-sm font-bold ${queued ? "text-[#f04b58]" : "text-[#f5f3ef]"}`}>{title}</h3>
    </div>
    <label htmlFor="queue-model" className="mb-2 block text-[10px] font-semibold uppercase tracking-widest text-zinc-400">AI model</label>
    {/* autoComplete="off": on reload, Firefox restores the previous page's enabled/disabled state
        before React loads, which no longer matches the server HTML and breaks hydration. */}
    <select id="queue-model" autoComplete="off" value={showQueue ? "" : selectedId} onChange={event => { setSelectedId(event.target.value); saveSelectedArena(event.target.value); }} disabled={selectionLocked} className={`h-12 w-full rounded-xl border border-white/10 bg-[#242529] px-3 text-sm text-zinc-300 disabled:text-zinc-400 ${focus}`}>
      {showQueue ? <option value="">{queuedModel?.display_name ?? "Existing queue · model unknown"}</option> : <>
        {!selectedId && <option value="">{signedOut ? "Sign in to choose an arena" : catalogPhase === "loading" ? "Loading arenas…" : "Choose an arena"}</option>}
        {listed.map(arena => <option key={arena.id} value={arena.id}>{arena.display_name}</option>)}
      </>}
    </select>
    <div aria-live="polite" className="mt-2 text-xs text-zinc-400">
      {catalogPhase === "loading" && <p>Loading arenas…</p>}
      {catalogPhase === "error" && <p>Couldn’t load arenas. <button onClick={refreshArenas} className={`underline ${focus}`}>Retry arenas</button></p>}
      {catalogPhase === "ready" && !arenas.some(arena => arena.kind === "provided") && <p>No arenas available yet. <button onClick={refreshArenas} className={`underline ${focus}`}>Refresh arenas</button></p>}
      {signedOut && <p>Sign in to choose an arena.</p>}
      {showQueue && !queuedModel && <p>Your existing queue’s model will be shown when the debate starts.</p>}
    </div>
    {byomSelected && !showQueue && <>
      <label htmlFor="queue-device" className="mb-2 mt-3 block text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Your device</label>
      <select id="queue-device" autoComplete="off" value={deviceId} onChange={event => setDeviceId(event.target.value)} disabled={selectionLocked || !devices?.length} className={`h-12 w-full rounded-xl border border-white/10 bg-[#242529] px-3 text-sm text-zinc-300 disabled:text-zinc-400 ${focus}`}>
        {devices === null ? <option value="">{devicesError ? "Couldn’t load devices" : "Loading devices…"}</option>
          : devices.length === 0 ? <option value="">No paired devices</option>
          : <>
              {!deviceId && <option value="">No device online</option>}
              {devices.map(device => <option key={device.id} value={device.id} disabled={device.status !== "idle"}>
                {device.name} · {device.model_name ?? "no model yet"}{device.size_class ? ` · ${SIZE_CLASS_LABELS[device.size_class]}` : ""}{device.status !== "idle" ? ` (${device.status})` : ""}
              </option>)}
            </>}
      </select>
      <div aria-live="polite" className="mt-2 text-xs text-zinc-400">
        {devicesError ? <p>Couldn’t load your devices. <button onClick={refreshDevices} className={`underline ${focus}`}>Retry</button></p>
          : devices?.length === 0 ? <p>Pair a computer running your model on the <Link href="/bilc" className={`underline ${focus}`}>BILC page</Link>.</p>
          : devices && !deviceReady ? <p>None of your devices is online. Run <span className="font-mono">bilc run</span> on one, then <button onClick={refreshDevices} className={`underline ${focus}`}>refresh</button>.</p>
          : null}
      </div>
    </>}
    <div className="flex min-h-12 items-center justify-between gap-2 text-[11px] text-zinc-500">
      <span>{queued ? "Time searching on this page" : byomSelected ? "Paired with models of a similar size" : "Players are paired within the same arena"}</span>
      {queued && <span className="font-mono text-sm tabular-nums text-[#ff7882]">{String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}</span>}
    </div>
    {phase === "matched" ? <p role="status" className="py-3 text-sm text-zinc-300">Entering the arena…</p>
      : signedOut && !queueActive ? <Link href="/login" className={`flex h-12 items-center justify-center rounded-xl bg-[#e53848] text-sm font-bold ${focus}`}>Sign in to queue</Link>
      : phase === "error" ? <div className="flex gap-2"><button onClick={() => request("GET")} className={`h-12 flex-1 rounded-xl bg-[#e53848] text-sm font-bold ${focus}`}>Retry queue status</button>{queueActive && <button onClick={() => request("DELETE")} className={`rounded-xl border border-white/15 px-3 text-sm ${focus}`}>Cancel queue</button>}</div>
      // Firefox restores native disabled state on reload, which can break hydration.
      : <button type="button" aria-disabled={buttonDisabled} onClick={() => { if (!buttonDisabled) request(queued ? "DELETE" : "POST"); }} className={`flex h-12 w-full items-center justify-center rounded-xl text-sm font-bold aria-disabled:cursor-not-allowed aria-disabled:opacity-50 ${focus} ${queued ? "border border-white/15 bg-white/5" : "bg-[#e53848] text-white not-aria-disabled:hover:bg-[#c92d3c]"}`}>{queued ? "Cancel queue" : phase === "cancelling" ? "Cancelling…" : phase === "checking" ? "Checking…" : phase === "joining" ? "Joining…" : "Join game"}</button>}
    {error && <p role="alert" className="mt-3 text-xs leading-relaxed text-red-300">{error}</p>}
    <p className="mt-3 text-center text-[10px] leading-relaxed text-zinc-500">{phase === "matched" ? "Your debate is ready." : queued ? "You can leave the queue anytime before an opponent is found." : "Choose a model to enter its arena."}</p>
  </div>;
}
