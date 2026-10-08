"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { parseArenas, parseQueueStatus, type Arena } from "../lib/protocol";

type Phase = "checking" | "idle" | "joining" | "cancelling" | "queued" | "matched" | "error" | "signed-out";
const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";

export default function MatchmakingCard() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [error, setError] = useState("");
  const router = useRouter();
  const [elapsed, setElapsed] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [arenas, setArenas] = useState<Arena[]>([]);
  const [catalogPhase, setCatalogPhase] = useState<"loading" | "ready" | "error" | "signed-out">("loading");
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState("");
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
        setSelectedId(previous => list.some(arena => arena.id === previous && arena.kind === "provided")
          ? previous : list.find(arena => arena.kind === "provided")?.id ?? "");
        setCatalogPhase("ready");
      } catch (err) {
        if (controller.signal.aborted) return;
        setCatalogPhase(err instanceof ApiError && err.status === 401 ? "signed-out" : "error");
      }
    }
    void load();
    return () => controller.abort();
  }, [catalogAttempt]);

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
              data = await api("/v1/match/queue", controller.signal, "POST", { model_id: model.id });
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
        if (err instanceof ApiError && err.status === 401) {
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
        } else if (err instanceof ApiError && err.code === "USERNAME_REQUIRED") {
          setPhase("idle");
          setError("Create your tag to join the queue.");
        } else {
          setPhase("error");
          setError("Couldn’t confirm your queue status. Retry queue status; we’ll check for an existing game or queue entry first.");
        }
      }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [attempt, router]);

  useEffect(() => {
    if (phase !== "queued") return;
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  function request(method: "GET" | "POST" | "DELETE") {
    if (busy.current) return;
    if (method === "POST") {
      const model = arenas.find(arena => arena.id === selectedId && arena.kind === "provided");
      if (catalogPhase !== "ready" || !model || phase !== "idle") return;
      joinModel.current = model;
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
  const canJoin = catalogPhase === "ready" && arenas.some(arena => arena.id === selectedId && arena.kind === "provided");
  const selectionLocked = phase !== "idle" || catalogPhase !== "ready";
  const showQueue = queueActive || phase === "matched";
  const signedOut = phase === "signed-out" || catalogPhase === "signed-out";
  const waiting = queued || phase === "joining" || phase === "checking" || phase === "cancelling";
  const title = {
    checking: "Checking queue…", idle: "Ready to ruffle feathers?", joining: "Joining queue…",
    cancelling: "Leaving queue…", queued: "Finding an opponent…", matched: "Opponent found!", error: "Queue status unavailable", "signed-out": "Join the debate",
  }[phase];

  return <div className={`min-w-0 rounded-3xl border p-4 xl:p-6 ${queued ? "border-[#f04b58]/35 bg-[#f04b58]/[0.035]" : "border-white/[0.08] bg-[#191a1d]"}`}>
    <div className="mb-5 flex items-center gap-3" role="status">
      {waiting && <span aria-hidden="true" className="h-8 w-8 shrink-0 rounded-full border-[3px] border-[#f04b58]/20 border-t-[#f04b58] motion-safe:animate-spin" />}
      <h3 className={`text-sm font-bold ${queued ? "text-[#f04b58]" : "text-[#f5f3ef]"}`}>{title}</h3>
    </div>
    <label htmlFor="queue-model" className="mb-2 block text-[10px] font-semibold uppercase tracking-widest text-zinc-400">AI model</label>
    <select id="queue-model" value={showQueue ? "" : selectedId} onChange={event => setSelectedId(event.target.value)} disabled={selectionLocked} className={`h-12 w-full rounded-xl border border-white/10 bg-[#242529] px-3 text-sm text-zinc-300 disabled:text-zinc-400 ${focus}`}>
      {showQueue ? <option value="">{queuedModel?.display_name ?? "Existing queue · model unknown"}</option> : <>
        {!selectedId && <option value="">{signedOut ? "Sign in to choose an arena" : catalogPhase === "loading" ? "Loading arenas…" : "Choose an arena"}</option>}
        {arenas.map(arena => <option key={arena.id} value={arena.id} disabled={arena.kind === "byom"}>{arena.display_name}{arena.kind === "byom" ? " (coming soon)" : ""}</option>)}
      </>}
    </select>
    <div aria-live="polite" className="mt-2 text-xs text-zinc-400">
      {catalogPhase === "loading" && <p>Loading arenas…</p>}
      {catalogPhase === "error" && <p>Couldn’t load arenas. <button onClick={refreshArenas} className={`underline ${focus}`}>Retry arenas</button></p>}
      {catalogPhase === "ready" && !arenas.some(arena => arena.kind === "provided") && <p>No arenas available yet. <button onClick={refreshArenas} className={`underline ${focus}`}>Refresh arenas</button></p>}
      {signedOut && <p>Sign in to choose an arena.</p>}
      {showQueue && !queuedModel && <p>Your existing queue’s model will be shown when the debate starts.</p>}
    </div>
    <div className="flex min-h-12 items-center justify-between gap-2 text-[11px] text-zinc-500">
      <span>{queued ? "Time searching on this page" : "Players are paired within the same arena"}</span>
      {queued && <span className="font-mono text-sm tabular-nums text-[#ff7882]">{String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}</span>}
    </div>
    {phase === "matched" ? <p role="status" className="py-3 text-sm text-zinc-300">Entering the arena…</p>
      : signedOut && !queueActive ? <Link href="/login" className={`flex h-12 items-center justify-center rounded-xl bg-[#e53848] text-sm font-bold ${focus}`}>Sign in to queue</Link>
      : phase === "error" ? <div className="flex gap-2"><button onClick={() => request("GET")} className={`h-12 flex-1 rounded-xl bg-[#e53848] text-sm font-bold ${focus}`}>Retry queue status</button>{queueActive && <button onClick={() => request("DELETE")} className={`rounded-xl border border-white/15 px-3 text-sm ${focus}`}>Cancel queue</button>}</div>
      : <button onClick={() => request(queued ? "DELETE" : "POST")} disabled={(waiting && !queued) || (!queued && !canJoin)} className={`flex h-12 w-full items-center justify-center rounded-xl text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50 ${focus} ${queued ? "border border-white/15 bg-white/5" : "bg-[#e53848] text-white enabled:hover:bg-[#c92d3c]"}`}>{queued ? "Cancel queue" : phase === "cancelling" ? "Cancelling…" : phase === "checking" ? "Checking…" : phase === "joining" ? "Joining…" : "Join game"}</button>}
    {error && <p role="alert" className="mt-3 text-xs leading-relaxed text-red-300">{error}</p>}
    <p className="mt-3 text-center text-[10px] leading-relaxed text-zinc-500">{phase === "matched" ? "Your debate is ready." : queued ? "You can leave the queue anytime before an opponent is found." : "Choose a model to enter its arena."}</p>
  </div>;
}
