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
