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
