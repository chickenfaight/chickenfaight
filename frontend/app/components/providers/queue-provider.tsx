"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "../../lib/api";
import { parseQueueStatus, type Arena, type QueueInfo, type QueueMode, type QueueStatus } from "../../lib/protocol";
import { useSession } from "./session-provider";

type QueuePhase = "checking" | "idle" | "joining" | "cancelling" | "queued" | "matched" | "finishing" | "error" | "signed-out";
export type ActiveQueue = {
  mode: QueueMode | null;
  modelName: string | null;
  joinedAt: string | null;
  elapsedSince: number; // performance.now() offset, seeded from the server
};
type QueueState = {
  phase: QueuePhase;
  queue: ActiveQueue | null;
  error: string;
  joinUnconfirmed: boolean;
};
type Join = { kind: "join"; arena: Arena; daily: boolean; deviceId: string };
type Operation = "status" | "cancel" | Join;
type JoinFailure = "arena" | "device" | "challenge" | null;
type Actions = {
  join: (arena: Arena, daily: boolean, deviceId: string) => Promise<JoinFailure>;
  cancel: () => void;
  retry: () => void;
};
type QueueValue = QueueState & Actions;

const initial: QueueState = { phase: "checking", queue: null, error: "", joinUnconfirmed: false };
const signedOut: QueueState = { ...initial, phase: "signed-out" };
const QueueContext = createContext<QueueValue | null>(null);

function joinBody(attempt: Join) {
  if (attempt.arena.id === "quick") return { model_id: null };
  if (attempt.daily) return { model_id: attempt.arena.id, daily: true };
  return attempt.arena.kind === "byom" ? { model_id: attempt.arena.id, bilc_id: attempt.deviceId }
    : { model_id: attempt.arena.id };
}

function waitingQueue(info: QueueInfo | null, previous: ActiveQueue | null, joined: Join | null): ActiveQueue {
  if (info) {
    const elapsedSince = performance.now() - info.elapsed_seconds * 1000;
    // Keep a stable running timer. Catch it up if the browser clock paused during sleep.
    if (previous?.joinedAt === info.joined_at && elapsedSince >= previous.elapsedSince - 1000) return previous;
    return { mode: info.mode, modelName: info.model_display_name, joinedAt: info.joined_at, elapsedSince };
  }
  if (previous) return previous;
  const mode = !joined ? null : joined.daily ? "daily" : joined.arena.id === "quick" ? "quick" : joined.arena.kind === "byom" ? "byom" : "model";
  return { mode, modelName: joined?.arena.display_name ?? null, joinedAt: null, elapsedSince: performance.now() };
}

export function queueName(queue: ActiveQueue): string {
  if (queue.mode === "quick") return "Quick Queue";
  if (queue.mode === "byom") return "Bring your own model";
  if (queue.mode === "daily") return queue.modelName ? `Daily challenge · ${queue.modelName}` : "Daily challenge";
  return queue.modelName ?? "Existing queue · model unknown";
}

export function showQueueIndicator({ queue, phase, joinUnconfirmed }: QueueState): boolean {
  return queue !== null || phase === "joining" || phase === "matched" || phase === "finishing" || joinUnconfirmed;
}

export default function QueueProvider({ children }: { children: ReactNode }) {
  const { user, status, refresh } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const inApp = !["/login", "/signup", "/health"].includes(pathname) && !pathname.startsWith("/match/");
  const owner = status === "in" && inApp ? user?.id ?? null : null;
  const scope = useMemo(() => ({ owner }), [owner]);
  const [published, setPublished] = useState<{ scope: typeof scope; state: QueueState } | null>(null);
  const actions = useRef<{ scope: typeof scope; commands: Actions } | null>(null);
  const visitedArena = useRef<{ userId: string; matchId: string } | null>(null);
  const userId = user?.id;

  useEffect(() => {
    if (userId && pathname.startsWith("/match/")) {
      visitedArena.current = { userId, matchId: pathname.slice("/match/".length) };
    }
  }, [pathname, userId]);

  useEffect(() => {
    if (!scope.owner) return;
    let state = initial;
    let active: { operation: Operation; controller: AbortController } | null = null;
    let timer: ReturnType<typeof setTimeout>;

    function publish(next: QueueState) {
      state = next;
      setPublished({ scope, state });
    }

    function poll() {
      timer = setTimeout(() => { void run("status"); }, 1000);
    }

    async function run(operation: Operation): Promise<JoinFailure> {
      const join = typeof operation === "object" ? operation : null;
      if (active && (active.operation !== "status" || operation === "status")) return null;
      if ((join && state.phase !== "idle") || (operation === "cancel" && !state.queue)) return null;
      if (state.phase === "matched" || state.phase === "signed-out") return null;

      clearTimeout(timer);
      active?.controller.abort();
      const controller = new AbortController();
      active = { operation, controller };
      const { signal } = controller;
      let submitted: Join | null = null;
      if (join || operation === "cancel" || state.phase === "error") {
        publish({ ...state, phase: join ? "joining" : operation === "cancel" ? "cancelling" : "checking", error: "" });
      }
      const readStatus = async () => parseQueueStatus(await api("/v1/match/status", signal));

      try {
        let next: QueueStatus;
        try {
          if (operation === "cancel") {
            await api("/v1/match/queue", signal, "DELETE");
            next = { status: "none" };
          } else {
            next = await readStatus();
            if (join && next.status === "none" && !signal.aborted) {
              submitted = join;
              next = parseQueueStatus(await api("/v1/match/queue", signal, "POST", joinBody(join)));
            }
          }
        } catch (error) {
          // Another tab may have queued in the meantime, or pairing won the cancellation race.
          if (!(error instanceof ApiError && error.status === 409 && (error.code === "ALREADY_QUEUED" || error.code === "IN_MATCH"))) throw error;
          submitted = null;
          next = await readStatus();
        }
        if (signal.aborted) return null;

        if (next.status === "matched") {
          // The server can still be finishing an arena that the player left after disconnecting.
          const visited = visitedArena.current;
          if (visited?.userId === scope.owner && visited.matchId === next.match_id) {
            if (state.phase !== "finishing") publish({ ...initial, phase: "finishing" });
            poll();
          } else {
            publish({ ...state, phase: "matched", error: "", joinUnconfirmed: false });
            router.push(`/match/${encodeURIComponent(next.match_id)}`);
          }
        } else if (next.status === "none") {
          publish({ ...initial, phase: "idle", error: submitted ? "The server reports no queue entry. You are not currently queued." : "" });
        } else {
          const queue = waitingQueue(next.queue, state.queue, submitted);
          if (queue !== state.queue || state.phase !== "queued") publish({ ...initial, queue, phase: "queued" });
          poll();
        }
      } catch (error) {
        if (signal.aborted) return null;
        if (error instanceof ApiError && error.status === 401) {
          publish(signedOut);
          void refresh();
          return null;
        } else if (submitted && error instanceof ApiError) {
          const code = error.code;
          if (submitted.arena.kind === "byom" && (code === "BILC_OFFLINE" || code === "BILC_BUSY" || code === "NOT_FOUND")) {
            const message = code === "NOT_FOUND" ? "That device is no longer paired. Choose another one." : error.detail ?? "That device can’t play right now.";
            publish({ ...initial, phase: "idle", error: message });
            return "device";
          }
          if (code === "NOT_FOUND" || code === "TAG_REQUIRED" || code === "CHALLENGE_ALREADY_COMPLETED") {
            const message = code === "NOT_FOUND" ? "That arena is no longer available. Choose an arena from the refreshed list."
              : code === "TAG_REQUIRED" ? "Create your tag to join the queue." : "You’ve already completed today’s challenge.";
            publish({ ...initial, phase: "idle", error: message });
            return code === "NOT_FOUND" ? "arena" : code === "TAG_REQUIRED" ? null : "challenge";
          }
        }
        publish({
          ...state, phase: "error", error: "Couldn’t confirm your queue status. Retry to check for an existing queue or debate.",
          joinUnconfirmed: state.joinUnconfirmed || submitted !== null,
        });
      } finally {
        if (active?.controller === controller) active = null;
      }
      return null;
    }

    actions.current = { scope, commands: {
      join: (arena, daily, deviceId) => run({ kind: "join", arena, daily, deviceId }),
      cancel: () => { void run("cancel"); },
      retry: () => { void run("status"); },
    } };
    const visible = () => { if (document.visibilityState === "visible") void run("status"); };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", visible);
    void run("status");
    return () => {
      actions.current = null;
      active?.controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", visible);
    };
  }, [scope, refresh, router]);

  const value = useMemo<QueueValue>(() => ({
    ...(published?.scope === scope ? published.state : status === "out" ? signedOut : status === "error"
      ? { ...initial, phase: "error" as const, error: "Couldn’t check your session. Retry to check your queue status." } : initial),
    join: (arena, daily, deviceId) => actions.current?.scope === scope ? actions.current.commands.join(arena, daily, deviceId) : Promise.resolve(null),
    cancel: () => { if (actions.current?.scope === scope) actions.current.commands.cancel(); },
    retry: () => {
      if (actions.current?.scope === scope) actions.current.commands.retry();
      else if (status === "error") void refresh();
    },
  }), [published, refresh, scope, status]);

  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>;
}

export function useQueue(): QueueValue {
  const queue = useContext(QueueContext);
  if (!queue) throw new Error("useQueue must be used inside QueueProvider");
  return queue;
}
