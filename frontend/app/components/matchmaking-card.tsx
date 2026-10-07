"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { parseQueueStatus } from "../lib/protocol";

type Phase = "checking" | "idle" | "joining" | "cancelling" | "queued" | "matched" | "error" | "signed-out";
const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";

export default function MatchmakingCard() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [error, setError] = useState("");
  const router = useRouter();
  const [elapsed, setElapsed] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const action = useRef<"GET" | "POST" | "DELETE">("GET");
  const busy = useRef(false);
  const activeController = useRef<AbortController | null>(null);

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
              data = await api("/v1/match/queue", controller.signal, "POST");
            }
          } else {
            data = await api(method === "DELETE" ? "/v1/match/queue" : "/v1/match/status", controller.signal, method);
          }
          if (method === "DELETE") data = { status: "none" };
        } catch (err) {
          // A previous tab/request may already have registered this user.
          if (err instanceof ApiError && err.status === 409 && ["ALREADY_QUEUED", "IN_MATCH"].includes(err.code ?? "")) {
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
          if (joining) {
            setError("The server reports no queue entry. You are not currently queued.");
          }
          busy.current = false;
          return;
        }
        setPhase("queued");
        busy.current = false;
        method = "GET";
        joining = false;
        timer = setTimeout(poll, 1000);
      } catch (err) {
        if (controller.signal.aborted) return;
        busy.current = false;
        if (err instanceof ApiError && err.status === 401) {
          setPhase("signed-out");
          setError("Sign in to join the queue.");
        } else if (err instanceof ApiError && err.code === "USERNAME_REQUIRED") {
          setPhase("idle");
          setError("Create your tag to join the queue.");
        } else {
          setPhase("error");
          setError("Couldn’t confirm your queue status. Try Join game again; we’ll check for an existing game or queue entry first.");
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
    busy.current = true;
    activeController.current?.abort();
    action.current = method;
    setError("");
    setElapsed(0);
    setPhase(method === "POST" ? "joining" : method === "DELETE" ? "cancelling" : "checking");
    setAttempt(value => value + 1);
  }

  const queued = phase === "queued";
  const waiting = queued || phase === "joining" || phase === "checking" || phase === "cancelling";
  const buttonDisabled = waiting && !queued;
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
    <select id="queue-model" disabled className="h-12 w-full rounded-xl border border-white/10 bg-[#242529] px-3 text-sm text-zinc-400"><option>Provided model</option></select>
    <div className="flex min-h-12 items-center justify-between gap-2 text-[11px] text-zinc-500">
      <span>{queued ? "Time searching on this page" : "One shared queue for now"}</span>
      {queued && <span className="font-mono text-sm tabular-nums text-[#ff7882]">{String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}</span>}
    </div>
    {phase === "matched" ? <p role="status" className="py-3 text-sm text-zinc-300">Entering the arena…</p>
      : phase === "signed-out" ? <Link href="/login" className={`flex h-12 items-center justify-center rounded-xl bg-[#e53848] text-sm font-bold ${focus}`}>Sign in to queue</Link>
      // aria-disabled instead of disabled: on reload, Firefox restores the previous page's `disabled`
      // state before React loads, which no longer matches the server HTML and breaks hydration.
      : <button type="button" aria-disabled={buttonDisabled} onClick={() => { if (!buttonDisabled) request(queued ? "DELETE" : "POST"); }} className={`flex h-12 w-full items-center justify-center rounded-xl text-sm font-bold aria-disabled:cursor-not-allowed aria-disabled:opacity-50 ${focus} ${queued ? "border border-white/15 bg-white/5" : "bg-[#e53848] text-white not-aria-disabled:hover:bg-[#c92d3c]"}`}>{queued ? "Cancel queue" : phase === "cancelling" ? "Cancelling…" : phase === "checking" ? "Checking…" : phase === "joining" ? "Joining…" : "Join game"}</button>}
    {error && <p role="alert" className="mt-3 text-xs leading-relaxed text-red-300">{error}</p>}
    <p className="mt-3 text-center text-[10px] leading-relaxed text-zinc-500">{phase === "matched" ? "Your debate is ready." : queued ? "You can leave the queue anytime before an opponent is found." : "Model selection is coming soon."}</p>
  </div>;
}
