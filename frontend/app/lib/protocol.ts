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

export type UserPublic = { id: string; username: string; avatar_url: string | null };

function isObject(data: unknown): data is Record<string, unknown> {
  return typeof data === "object" && data !== null;
}

// Search and profiles only ever return tagged users, so `username` is required here.
export function parseUserPublic(data: unknown): UserPublic {
  if (!isObject(data) || typeof data.id !== "string" || typeof data.username !== "string"
    || !(data.avatar_url === null || typeof data.avatar_url === "string")) {
    throw new Error("Invalid user");
  }
  return { id: data.id, username: data.username, avatar_url: data.avatar_url };
}

export type UserSearchPage = { items: UserPublic[]; next_offset: number | null };

export function parseUserSearchPage(data: unknown): UserSearchPage {
  if (!isObject(data) || !Array.isArray(data.items)
    || !(data.next_offset === null || typeof data.next_offset === "number")) {
    throw new Error("Invalid search page");
  }
  return { items: data.items.map(parseUserPublic), next_offset: data.next_offset };
}

export type Rating = { ladder: string; elo: number; games_played: number; wins: number; losses: number };
export type UserProfile = UserPublic & { ratings: Rating[] };

function parseRating(data: unknown): Rating {
  if (!isObject(data) || typeof data.ladder !== "string"
    || [data.elo, data.games_played, data.wins, data.losses].some((value) => typeof value !== "number")) {
    throw new Error("Invalid rating");
  }
  return data as Rating;
}

export function parseUserProfile(data: unknown): UserProfile {
  if (!isObject(data) || !Array.isArray(data.ratings)) throw new Error("Invalid profile");
  return { ...parseUserPublic(data), ratings: data.ratings.map(parseRating) };
}
