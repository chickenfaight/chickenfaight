"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { backendUrl } from "../../lib/auth";
import { parseMatchMessage, type ArenaPlayer, type ArenaResult, type ArenaTopic, type MatchChallenge, type MatchMessage, type Side } from "../../lib/protocol";

type State = {
  phase: "connecting" | "choosing" | "introducing" | "prompting" | "generating" | "waiting" | "judging" | "completed";
  topic: ArenaTopic | null;
  model_display_name: string | null;
  side: Side | null;
  deadline: string | null;
  pickPending: boolean;
  promptClosed: boolean;
  challenge: MatchChallenge | null;
  // Both players for the face-off; empty if the server didn't say.
  participants: ArenaPlayer[];
  prompt: string | null;
  argument: string;
  result: ArenaResult | null;
  error: string;
  disconnected: boolean;
};
type Action = MatchMessage | { type: "CHOICE_SENT" } | { type: "SUBMITTED"; prompt: string } | { type: "DISCONNECTED"; message: string };
const initialState: State = { phase: "connecting", topic: null, model_display_name: null, side: null, deadline: null, pickPending: false, promptClosed: false, challenge: null, participants: [], prompt: null, argument: "", result: null, error: "", disconnected: false };

// Errors meaning the prompt wasn't accepted, so the player can edit and resubmit.
const REJECTED_PROMPT = ["PROMPT_TOO_LONG", "BAD_MESSAGE", "PROMPT_BREAKS_CHALLENGE", "PROMPT_WINDOW_NOT_OPEN"];
const REJECTED_CHOICE = ["BAD_MESSAGE", "SIDE_SELECTION_NOT_OPEN"];

function reducer(state: State, action: Action): State {
  if (state.phase === "completed") return state;
  switch (action.type) {
    case "SIDE_SELECTION_OPEN": {
      if (state.phase !== "connecting") return state;
      const { model_display_name, topic, deadline } = action.payload;
      return { ...state, model_display_name, topic, deadline, phase: "choosing", error: "" };
    }
    case "CHOICE_SENT": return state.phase === "choosing" ? { ...state, pickPending: true, error: "" } : state;
    case "MATCH_INTRO": case "MATCH_STATE": {
      if (state.phase !== "connecting" && state.phase !== "choosing"
        && !(action.type === "MATCH_STATE" && state.phase === "introducing")) return state;
      const { model_display_name, topic, you, deadline, challenge, participants } = action.payload;
      return { ...state, model_display_name, topic, side: you, deadline, challenge, participants,
        phase: action.type === "MATCH_INTRO" ? "introducing" : "prompting", pickPending: false, error: "" };
    }
    case "SUBMITTED": return { ...state, prompt: action.prompt, phase: "generating", error: "" };
    case "TURN_DELTA": return { ...state, argument: state.argument + action.payload.delta };
    case "TURN_END": return { ...state, phase: "waiting" };
    case "JUDGING": return { ...state, phase: "judging" };
    case "MATCH_RESULT": return { ...state, result: action.payload, phase: "completed", error: "" };
    case "DISCONNECTED": return { ...state, error: action.message, disconnected: true };
    case "ERROR": {
      if (state.phase === "choosing" && REJECTED_CHOICE.includes(action.payload.code)) {
        return { ...state, error: action.payload.message, pickPending: false };
      }
      const promptClosed = action.payload.code === "PROMPT_DEADLINE_PASSED";
      const rejected = state.phase === "generating" && !state.argument && (promptClosed || REJECTED_PROMPT.includes(action.payload.code));
      return { ...state, error: action.payload.message, ...(rejected ? { phase: "prompting" as const, prompt: null, promptClosed } : {}) };
    }
    default: return state;
  }
}

// How long `resign()` waits for the server's MATCH_RESULT before resolving anyway.
const RESIGN_TIMEOUT_MS = 3000;

type MatchValue = { state: State; chooseSide: (side: Side) => void; submitPrompt: (prompt: string) => boolean; resign: () => Promise<void> };
const MatchContext = createContext<MatchValue | null>(null);

export function MatchProvider({ matchId, children }: { matchId: string; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const socket = useRef<WebSocket | null>(null);
  const pickSent = useRef(false);
  const submitted = useRef(false);
  // Resolves a pending `resign()` once the match ends or the socket closes.
  const settleResign = useRef<(() => void) | null>(null);

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
      ws.onopen = () => {
        if (disposed) return;
        ws.send(JSON.stringify({ type: "JOIN", payload: { protocol_version: 1 } }));
        watchHeartbeat();
      };
      ws.onmessage = event => {
        if (disposed) return;
        watchHeartbeat();
        try {
          const message = parseMatchMessage(event.data);
          if (message.type === "HEARTBEAT") { ws.send(JSON.stringify(message)); return; }
          if (message.type === "MATCH_RESULT") { completed = true; settleResign.current?.(); }
          if (message.type === "ERROR" && REJECTED_PROMPT.includes(message.payload.code)) submitted.current = false;
          if (message.type === "ERROR" && REJECTED_CHOICE.includes(message.payload.code)) pickSent.current = false;
          dispatch(message);
        } catch {
          dispatch({ type: "DISCONNECTED", message: "Couldn’t read the debate update. Return to the lobby to try again." });
          ws.close();
        }
      };
      ws.onclose = () => {
        clearTimeout(heartbeatTimer);
        settleResign.current?.();
        if (!disposed && !completed) dispatch({ type: "DISCONNECTED", message: "This debate is unavailable or the connection was lost. Return to the lobby to try again." });
      };
      ws.onerror = () => {
        if (!disposed && !completed) dispatch({ type: "DISCONNECTED", message: "Couldn’t connect to this debate. Check that you’re signed in and assigned to this arena." });
      };
    }, 0);
    return () => { disposed = true; clearTimeout(timer); clearTimeout(heartbeatTimer); socket.current?.close(); socket.current = null; };
  }, [matchId]);

  const chooseSide = useCallback((side: Side) => {
    if (state.phase !== "choosing" || state.disconnected || pickSent.current || socket.current?.readyState !== WebSocket.OPEN) return;
    socket.current.send(JSON.stringify({ type: "CHOOSE_SIDE", payload: { side } }));
    pickSent.current = true;
    dispatch({ type: "CHOICE_SENT" });
  }, [state.phase, state.disconnected]);

  const submitPrompt = useCallback((prompt: string) => {
    if (state.phase !== "prompting" || state.disconnected || state.promptClosed || submitted.current
      || socket.current?.readyState !== WebSocket.OPEN || !prompt.trim() || prompt.length > 2000) return false;
    socket.current.send(JSON.stringify({ type: "SUBMIT_PROMPT", payload: { prompt } }));
    submitted.current = true;
    dispatch({ type: "SUBMITTED", prompt });
    return true;
  }, [state.phase, state.disconnected, state.promptClosed]);
  // Forfeits the match. Resolves once the server confirms the result (so the lobby stops
  // reporting this match), or after a timeout if the connection is gone.
  const resign = useCallback(() => new Promise<void>((resolve) => {
    const ws = socket.current;
    if (ws?.readyState !== WebSocket.OPEN) { resolve(); return; }
    const timer = setTimeout(done, RESIGN_TIMEOUT_MS);
    function done() { clearTimeout(timer); settleResign.current = null; resolve(); }
    settleResign.current = done;
    ws.send(JSON.stringify({ type: "RESIGN", payload: {} }));
  }), []);
  const value = useMemo(() => ({ state, chooseSide, submitPrompt, resign }), [state, chooseSide, submitPrompt, resign]);
  return <MatchContext.Provider value={value}>{children}</MatchContext.Provider>;
}

export function useMatch() {
  const context = useContext(MatchContext);
  if (!context) throw new Error("useMatch requires MatchProvider");
  return context;
}
