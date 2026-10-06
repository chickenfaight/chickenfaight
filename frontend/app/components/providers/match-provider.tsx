"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { backendUrl } from "../../lib/auth";
import { parseMatchMessage, type ArenaResult, type ArenaTopic, type MatchMessage, type Side } from "../../lib/protocol";

type State = {
  phase: "connecting" | "prompting" | "generating" | "waiting" | "judging" | "completed";
  topic: ArenaTopic | null;
  side: Side;
  deadline: string | null;
  prompt: string | null;
  argument: string;
  result: ArenaResult | null;
  error: string;
  disconnected: boolean;
};
type Action = MatchMessage | { type: "SUBMITTED"; prompt: string } | { type: "DISCONNECTED"; message: string };
const initialState: State = { phase: "connecting", topic: null, side: "pro", deadline: null, prompt: null, argument: "", result: null, error: "", disconnected: false };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "MATCH_STATE": return { ...state, topic: action.payload.topic, side: action.payload.you, deadline: action.payload.deadline, phase: "prompting" };
    case "SUBMITTED": return { ...state, prompt: action.prompt, phase: "generating", error: "" };
    case "TURN_DELTA": return { ...state, argument: state.argument + action.payload.delta };
    case "TURN_END": return { ...state, phase: "waiting" };
    case "JUDGING": return { ...state, phase: "judging" };
    case "MATCH_RESULT": return { ...state, result: action.payload, phase: "completed", error: "" };
    case "DISCONNECTED": return state.result ? state : { ...state, error: action.message, disconnected: true };
    case "ERROR": {
      const rejected = ["PROMPT_TOO_LONG", "BAD_MESSAGE"].includes(action.payload.code) && !state.argument;
      return { ...state, error: action.payload.message, ...(rejected ? { phase: "prompting" as const, prompt: null } : {}) };
    }
    default: return state;
  }
}

const MatchContext = createContext<{ state: State; submitPrompt: (prompt: string) => boolean } | null>(null);

export function MatchProvider({ matchId, children }: { matchId: string; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const socket = useRef<WebSocket | null>(null);
  const submitted = useRef(false);

  useEffect(() => {
    let disposed = false;
    let completed = false;
    let heartbeatTimer: ReturnType<typeof setTimeout>;
    // Defer connection so React's development effect check doesn't briefly join a match.
    const timer = setTimeout(() => {
      const url = new URL(`${backendUrl}/v1/game/${encodeURIComponent(matchId)}/ws`);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(url);
      socket.current = ws;
      function watchHeartbeat() {
        clearTimeout(heartbeatTimer);
        heartbeatTimer = setTimeout(() => ws.close(), 45000);
      }
      ws.onopen = watchHeartbeat;
      ws.onmessage = event => {
        if (disposed) return;
        watchHeartbeat();
        try {
          const message = parseMatchMessage(event.data);
          if (message.type === "HEARTBEAT") { ws.send(JSON.stringify(message)); return; }
          if (message.type === "MATCH_RESULT") completed = true;
          if (message.type === "ERROR" && ["PROMPT_TOO_LONG", "BAD_MESSAGE"].includes(message.payload.code)) submitted.current = false;
          dispatch(message);
        } catch {
          dispatch({ type: "DISCONNECTED", message: "Couldn’t read the debate update. Return to the lobby to try again." });
          ws.close();
        }
      };
      ws.onclose = () => {
        clearTimeout(heartbeatTimer);
        if (!disposed && !completed) dispatch({ type: "DISCONNECTED", message: "This debate is unavailable or the connection was lost. Return to the lobby to try again." });
      };
      ws.onerror = () => {
        if (!disposed && !completed) dispatch({ type: "DISCONNECTED", message: "Couldn’t connect to this debate. Check that you’re signed in and assigned to this arena." });
      };
    }, 0);
    return () => { disposed = true; clearTimeout(timer); clearTimeout(heartbeatTimer); socket.current?.close(); socket.current = null; };
  }, [matchId]);

  const submitPrompt = useCallback((prompt: string) => {
    if (submitted.current || socket.current?.readyState !== WebSocket.OPEN || !prompt.trim() || prompt.length > 2000) return false;
    socket.current.send(JSON.stringify({ type: "SUBMIT_PROMPT", payload: { prompt } }));
    submitted.current = true;
    dispatch({ type: "SUBMITTED", prompt });
    return true;
  }, []);
  const value = useMemo(() => ({ state, submitPrompt }), [state, submitPrompt]);
  return <MatchContext.Provider value={value}>{children}</MatchContext.Provider>;
}

export function useMatch() {
  const context = useContext(MatchContext);
  if (!context) throw new Error("useMatch requires MatchProvider");
  return context;
}
