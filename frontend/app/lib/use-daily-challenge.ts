import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { parseChallengeToday, type ChallengeToday } from "./protocol";

type ChallengeState =
  | { status: "loading" | "error"; challenge: null }
  | { status: "ready"; challenge: ChallengeToday };

const loading = { status: "loading", challenge: null } as const;
const RESET_RETRY_MS = 30_000;

export function useDailyChallenge(enabled = true) {
  const router = useRouter();
  const [state, setState] = useState<ChallengeState>(loading);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resetAt = Infinity;
    let pending = false;

    function schedule(delay: number) {
      clearTimeout(timer);
      timer = setTimeout(() => { void load(); }, delay);
    }

    async function load() {
      if (Date.now() >= resetAt) setState(loading);
      if (pending) return;
      pending = true;
      try {
        const challenge = parseChallengeToday(await api("/v1/challenge/today", controller.signal));
        if (controller.signal.aborted) return;
        resetAt = Date.parse(challenge.resets_at);
        if (!Number.isFinite(resetAt)) throw new Error("Invalid challenge reset");
        const delay = resetAt - Date.now();
        // The browser can reach midnight slightly ahead of the server. Wait for the new day.
        if (delay <= 0) {
          setState(loading);
          schedule(RESET_RETRY_MS);
        } else {
          setState({ status: "ready", challenge });
          schedule(delay);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError && err.status === 401) { router.replace("/login"); return; }
        setState({ status: "error", challenge: null });
      } finally {
        pending = false;
      }
    }

    function refreshVisible() {
      if (document.visibilityState === "visible") void load();
    }

    void load();
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [enabled, attempt, router]);

  function refresh() {
    setState(loading);
    setAttempt(value => value + 1);
  }

  return { ...(enabled ? state : loading), refresh };
}
