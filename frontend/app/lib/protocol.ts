export type User = { username: string | null; elo: number };

export function parseUser(data: unknown): User {
  if (typeof data !== "object" || data === null || !("elo" in data) || !("username" in data)
    || typeof data.elo !== "number" || !(data.username === null || typeof data.username === "string")) {
    throw new Error("Invalid user");
  }
  return { username: data.username, elo: data.elo };
}

// Mirrors the server's tag format rule; the server re-checks it and adds profanity and uniqueness checks.
export function usernameFormatError(value: string): string | null {
  if (value.length < 3) return "Use at least 3 characters.";
  if (value.length > 24) return "Use 24 characters or fewer.";
  if (!/^[A-Za-z0-9_]+$/.test(value)) return "Use only letters, numbers, and underscores.";
  return null;
}

export type UsernameAvailability = { available: true } | { available: false; detail: string };

export function parseUsernameAvailability(data: unknown): UsernameAvailability {
  if (typeof data !== "object" || data === null || !("available" in data)) throw new Error("Invalid availability");
  if (data.available === true) return { available: true };
  if (data.available === false && "detail" in data && typeof data.detail === "string") {
    return { available: false, detail: data.detail };
  }
  throw new Error("Invalid availability");
}

export type QueueStatus =
  | { status: "none" | "queued" }
  | { status: "matched"; match_id: string };

export function parseQueueStatus(data: unknown): QueueStatus {
  if (typeof data !== "object" || data === null || !("status" in data)) {
    throw new Error("Invalid queue status");
  }
  if (data.status === "none" || data.status === "queued") return { status: data.status };
  if (data.status === "matched" && "match_id" in data && typeof data.match_id === "string" && data.match_id.trim()) {
    return { status: "matched", match_id: data.match_id };
  }
  throw new Error("Invalid queue status");
}

// Current arena wire format in PROTOCOL.md; full reconnect snapshots are planned.
export type Side = "pro" | "con";
export type ArenaTopic = { topic: string; pro_position: string; con_position: string };
export type ArenaResult = {
  winner: Side | null;
  reason: string;
  status: "completed" | "forfeited" | "voided";
  end_reason: "judged" | "no_prompt";
  arguments: Record<Side, string>;
};
export type MatchMessage =
  | { type: "MATCH_STATE"; payload: { topic: ArenaTopic; you: Side; deadline: string | null } }
  | { type: "TURN_DELTA"; payload: { delta: string } }
  | { type: "TURN_END" | "JUDGING"; payload: Record<string, unknown> }
  | { type: "MATCH_RESULT"; payload: ArenaResult }
  | { type: "HEARTBEAT"; payload: Record<string, unknown> }
  | { type: "ERROR"; payload: { code: string; message: string } };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function side(value: unknown): value is Side { return value === "pro" || value === "con"; }

export function parseMatchMessage(raw: string): MatchMessage {
  const data: unknown = JSON.parse(raw);
  if (!record(data) || !record(data.payload)) throw new Error("Invalid match message");
  const p = data.payload;
  switch (data.type) {
    case "MATCH_STATE":
      if (record(p.topic) && typeof p.topic.topic === "string" && typeof p.topic.pro_position === "string"
        && typeof p.topic.con_position === "string" && side(p.you)
        && (p.deadline === null || (typeof p.deadline === "string" && Number.isFinite(Date.parse(p.deadline))))) {
        return { type: data.type, payload: { topic: p.topic as ArenaTopic, you: p.you, deadline: p.deadline } };
      }
      break;
    case "TURN_DELTA":
      if (typeof p.delta === "string") return { type: data.type, payload: { delta: p.delta } };
      break;
    case "TURN_END": case "JUDGING": case "HEARTBEAT":
      return { type: data.type, payload: p };
    case "MATCH_RESULT":
      if ((p.winner === null || side(p.winner)) && typeof p.reason === "string"
        && ["completed", "forfeited", "voided"].includes(String(p.status))
        && ["judged", "no_prompt"].includes(String(p.end_reason))
        && record(p.arguments) && typeof p.arguments.pro === "string" && typeof p.arguments.con === "string") {
        return { type: data.type, payload: p as ArenaResult };
      }
      break;
    case "ERROR":
      if (typeof p.code === "string" && typeof p.message === "string") return { type: data.type, payload: { code: p.code, message: p.message } };
  }
  throw new Error("Invalid match message");
}
