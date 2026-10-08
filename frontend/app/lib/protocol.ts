// `tag` is the permanent unique identifier (set once); `username` is the changeable display name.
// `email` is private: only `/auth/me` returns it, to its owner.
export type User = { id: string; tag: string | null; username: string | null; email: string | null; elo: number };

function optionalString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function parseUser(data: unknown): User {
  if (typeof data !== "object" || data === null || !("id" in data) || !("elo" in data) || !("tag" in data) || !("username" in data)
    || typeof data.id !== "string" || typeof data.elo !== "number"
    || !optionalString(data.tag) || !optionalString(data.username) || !("email" in data) || !optionalString(data.email)) {
    throw new Error("Invalid user");
  }
  return { id: data.id, tag: data.tag, username: data.username, email: data.email, elo: data.elo };
}

// What to call a player: their username, or their tag if they haven't set one.
export function displayName(user: { tag: string; username: string | null }): string {
  return user.username || user.tag;
}

// Mirrors the server's tag format rule; the server re-checks it and adds profanity and uniqueness checks.
export function tagFormatError(value: string): string | null {
  if (value.length < 3) return "Use at least 3 characters.";
  if (value.length > 24) return "Use 24 characters or fewer.";
  if (!/^[A-Za-z0-9_]+$/.test(value)) return "Use only letters, numbers, and underscores.";
  return null;
}

export type TagAvailability = { available: true } | { available: false; detail: string };

export function parseTagAvailability(data: unknown): TagAvailability {
  if (typeof data !== "object" || data === null || !("available" in data)) throw new Error("Invalid availability");
  if (data.available === true) return { available: true };
  if (data.available === false && "detail" in data && typeof data.detail === "string") {
    return { available: false, detail: data.detail };
  }
  throw new Error("Invalid availability");
}

export type Arena = { id: string; display_name: string; kind: "provided" | "byom" };

export function parseArenas(data: unknown): Arena[] {
  if (!Array.isArray(data)) throw new Error("Invalid arena list");
  const ids = new Set<string>();
  return data.map((item: unknown) => {
    if (!isObject(item) || typeof item.id !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id)
      || typeof item.display_name !== "string" || !item.display_name.trim()
      || (item.kind !== "provided" && item.kind !== "byom") || ids.has(item.id)) {
      throw new Error("Invalid arena");
    }
    ids.add(item.id);
    return { id: item.id, display_name: item.display_name, kind: item.kind };
  });
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

export type UserPublic = { id: string; tag: string; username: string | null; avatar_url: string | null };

function isObject(data: unknown): data is Record<string, unknown> {
  return typeof data === "object" && data !== null;
}

// Search and profiles only ever return tagged users, so `tag` is required here.
export function parseUserPublic(data: unknown): UserPublic {
  if (!isObject(data) || typeof data.id !== "string" || typeof data.tag !== "string"
    || !optionalString(data.username) || !optionalString(data.avatar_url)) {
    throw new Error("Invalid user");
  }
  return { id: data.id, tag: data.tag, username: data.username, avatar_url: data.avatar_url };
}

// A page of players, as returned by search and the friends list.
export type UserPage = { items: UserPublic[]; next_offset: number | null };

export function parseUserPage(data: unknown): UserPage {
  if (!isObject(data) || !Array.isArray(data.items)
    || !(data.next_offset === null || typeof data.next_offset === "number")) {
    throw new Error("Invalid user page");
  }
  return { items: data.items.map(parseUserPublic), next_offset: data.next_offset };
}

export type Rating = { ladder: string; elo: number; games_played: number; wins: number; losses: number };
export type UserProfile = UserPublic & { ratings: Rating[]; is_friend: boolean; points: number; streak: number; rank: number | null };

function parseRating(data: unknown): Rating {
  if (!isObject(data) || typeof data.ladder !== "string"
    || [data.elo, data.games_played, data.wins, data.losses].some((value) => typeof value !== "number")) {
    throw new Error("Invalid rating");
  }
  return data as Rating;
}

export function parseUserProfile(data: unknown): UserProfile {
  if (!isObject(data) || !Array.isArray(data.ratings) || typeof data.is_friend !== "boolean"
    || typeof data.points !== "number" || typeof data.streak !== "number" || !(data.rank === null || typeof data.rank === "number")) {
    throw new Error("Invalid profile");
  }
  return { ...parseUserPublic(data), ratings: data.ratings.map(parseRating), is_friend: data.is_friend, points: data.points, streak: data.streak, rank: data.rank };
}

// The daily challenge's twist, as announced in MATCH_STATE and GET /v1/challenge/today.
export type MatchChallenge = { title: string; description: string; max_chars: number | null };

function parseChallenge(data: unknown): MatchChallenge | null {
  if (data === null || data === undefined) return null;
  if (!isObject(data) || typeof data.title !== "string" || typeof data.description !== "string"
    || !(data.max_chars === null || typeof data.max_chars === "number")) {
    throw new Error("Invalid challenge");
  }
  return { title: data.title, description: data.description, max_chars: data.max_chars };
}

export type ChallengeToday = {
  day: string; topic: ArenaTopic | null; twist: MatchChallenge; reward_points: number; completed: boolean; resets_at: string;
};

export function parseChallengeToday(data: unknown): ChallengeToday {
  if (!isObject(data) || typeof data.day !== "string" || typeof data.reward_points !== "number"
    || typeof data.completed !== "boolean" || typeof data.resets_at !== "string") {
    throw new Error("Invalid challenge");
  }
  const topic = data.topic;
  const parsedTopic = isObject(topic) && typeof topic.topic === "string" && typeof topic.pro_position === "string" && typeof topic.con_position === "string"
    ? { topic: topic.topic, pro_position: topic.pro_position, con_position: topic.con_position } : null;
  const twist = parseChallenge(data.twist);
  if (!twist) throw new Error("Invalid challenge");
  return { day: data.day, topic: parsedTopic, twist, reward_points: data.reward_points, completed: data.completed, resets_at: data.resets_at };
}

// Current arena wire format in PROTOCOL.md; full reconnect snapshots are planned.
export type Side = "pro" | "con";
export type ArenaTopic = { topic: string; pro_position: string; con_position: string };
export type ArenaResult = {
  winner: Side | null;
  reason: string;
  status: "completed" | "forfeited" | "voided";
  end_reason: "judged" | "no_prompt" | "resigned" | "model_failure" | "judge_failure";
  arguments: Record<Side, string>;
};
export type MatchMessage =
  | { type: "MATCH_STATE"; payload: { model_display_name: string; topic: ArenaTopic; you: Side; deadline: string | null; challenge: MatchChallenge | null } }
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
      if (typeof p.model_display_name === "string" && p.model_display_name.trim() && record(p.topic) && typeof p.topic.topic === "string" && typeof p.topic.pro_position === "string"
        && typeof p.topic.con_position === "string" && side(p.you)
        && (p.deadline === null || (typeof p.deadline === "string" && Number.isFinite(Date.parse(p.deadline))))) {
        return { type: data.type, payload: { model_display_name: p.model_display_name, topic: p.topic as ArenaTopic, you: p.you, deadline: p.deadline, challenge: parseChallenge(p.challenge) } };
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
        && ["judged", "no_prompt", "resigned", "model_failure", "judge_failure"].includes(String(p.end_reason))
        && record(p.arguments) && typeof p.arguments.pro === "string" && typeof p.arguments.con === "string") {
        return { type: data.type, payload: p as ArenaResult };
      }
      break;
    case "ERROR":
      if (typeof p.code === "string" && typeof p.message === "string") return { type: data.type, payload: { code: p.code, message: p.message } };
  }
  throw new Error("Invalid match message");
}
