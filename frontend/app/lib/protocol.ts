// `tag` is the permanent unique identifier (set once); `username` is the changeable display name.
// `email` is private and only returned to its owner in UserRead.
// `is_admin`: the backend lists this tag as an admin. It only decides what to show; admin routes check it again.
export type User = { id: string; tag: string | null; username: string | null; email: string | null; avatar_url: string | null; is_admin: boolean };

export type ArenaStats = { points: number; debates_played: number; wins: number; win_rate: number | null; recent_form: ("W" | "L")[] };

export function parseArenaStats(data: unknown): ArenaStats {
  if (!isObject(data)
    || ![data.points, data.debates_played, data.wins].every(value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    || (data.win_rate !== null && (typeof data.win_rate !== "number" || !Number.isFinite(data.win_rate) || data.win_rate < 0 || data.win_rate > 100))
    || !Array.isArray(data.recent_form) || data.recent_form.length > 5 || !data.recent_form.every(value => value === "W" || value === "L")) {
    throw new Error("Invalid arena stats");
  }
  return data as ArenaStats;
}

function optionalString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function parseUser(data: unknown): User {
  if (typeof data !== "object" || data === null || !("id" in data) || !("tag" in data) || !("username" in data)
    || typeof data.id !== "string"
    || !optionalString(data.tag) || !optionalString(data.username) || !("email" in data) || !optionalString(data.email)
    || !("avatar_url" in data) || !optionalString(data.avatar_url)) {
    throw new Error("Invalid user");
  }
  return { id: data.id, tag: data.tag, username: data.username, email: data.email, avatar_url: data.avatar_url, is_admin: "is_admin" in data && data.is_admin === true };
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

export type Arena = { id: string; display_name: string; kind: "provided" | "byom"; provider_slug?: string | null; model_slug?: string | null };

export function parseArenas(data: unknown): Arena[] {
  if (!Array.isArray(data)) throw new Error("Invalid arena list");
  const ids = new Set<string>();
  return data.map((item: unknown) => {
    if (!isObject(item) || typeof item.id !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id)
      || typeof item.display_name !== "string" || !item.display_name.trim()
      || (item.kind !== "provided" && item.kind !== "byom") || ids.has(item.id)
      || (item.provider_slug !== undefined && !optionalString(item.provider_slug))
      || (item.model_slug !== undefined && !optionalString(item.model_slug))) {
      throw new Error("Invalid arena");
    }
    ids.add(item.id);
    return { id: item.id, display_name: item.display_name, kind: item.kind,
      ...(item.provider_slug !== undefined ? { provider_slug: item.provider_slug as string | null } : {}),
      ...(item.model_slug !== undefined ? { model_slug: item.model_slug as string | null } : {}) };
  });
}

export type QueueMode = "quick" | "model" | "daily" | "byom";
export type QueueInfo = {
  mode: QueueMode;
  model_id: string | null;
  model_display_name: string | null;
  joined_at: string;
  elapsed_seconds: number;
};

export type QueueStatus =
  | { status: "none" }
  | { status: "queued"; queue: QueueInfo | null }
  | { status: "matched"; match_id: string };

export function parseQueueStatus(data: unknown): QueueStatus {
  if (isObject(data)) {
    if (data.status === "none") return { status: "none" };
    if (data.status === "matched" && typeof data.match_id === "string" && data.match_id.trim()) {
      return { status: "matched", match_id: data.match_id };
    }
    if (data.status === "queued") {
      if (data.queue === undefined) return { status: "queued", queue: null };
      const queue = data.queue;
      if (isObject(queue)
        && (queue.mode === "quick" || queue.mode === "model" || queue.mode === "daily" || queue.mode === "byom")
        && optionalString(queue.model_id) && optionalString(queue.model_display_name)
        && typeof queue.joined_at === "string" && Number.isFinite(Date.parse(queue.joined_at))
        && typeof queue.elapsed_seconds === "number" && Number.isSafeInteger(queue.elapsed_seconds) && queue.elapsed_seconds >= 0) {
        return { status: "queued", queue: {
          mode: queue.mode, model_id: queue.model_id, model_display_name: queue.model_display_name,
          joined_at: queue.joined_at, elapsed_seconds: queue.elapsed_seconds,
        } };
      }
    }
  }
  throw new Error("Invalid queue status");
}

export type UserPublic = { id: string; tag: string; username: string | null; avatar_url: string | null };

function isObject(data: unknown): data is Record<string, unknown> {
  return typeof data === "object" && data !== null;
}

// Player listings and profiles only ever return tagged users, so `tag` is required here.
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
// A pending friend request between the caller and a player: "sent" by the caller, or "received" from them.
export type FriendRequestState = "sent" | "received" | null;
export type UserProfile = UserPublic & { ratings: Rating[]; read_blocked: boolean; is_blocked: boolean; is_friend: boolean; friend_request: FriendRequestState; points: number; streak: number; rank: number | null; score_averages: ScoreAverages | null };

function isFriendRequestState(value: unknown): value is FriendRequestState {
  return value === null || value === "sent" || value === "received";
}

export function parseFriendshipStatus(data: unknown): { is_friend: boolean; friend_request: FriendRequestState } {
  if (!isObject(data) || typeof data.is_friend !== "boolean" || !isFriendRequestState(data.friend_request)) throw new Error("Invalid friendship status");
  return { is_friend: data.is_friend, friend_request: data.friend_request };
}

function parseRating(data: unknown): Rating {
  if (!isObject(data) || typeof data.ladder !== "string"
    || [data.elo, data.games_played, data.wins, data.losses].some((value) => typeof value !== "number")) {
    throw new Error("Invalid rating");
  }
  return data as Rating;
}

export type Ladder = { slug: string; display_name: string; kind: "cloud" | "byom" };
export type LeaderboardEntry = { rank: number; user: UserPublic; rating: Rating };

export function parseLadders(data: unknown): Ladder[] {
  if (!Array.isArray(data)) throw new Error("Invalid ladders");
  return data.map((item: unknown) => {
    if (!isObject(item) || typeof item.slug !== "string" || typeof item.display_name !== "string"
      || (item.kind !== "cloud" && item.kind !== "byom")) throw new Error("Invalid ladder");
    return { slug: item.slug, display_name: item.display_name, kind: item.kind };
  });
}

export function parseLeaderboard(data: unknown): LeaderboardEntry[] {
  if (!Array.isArray(data)) throw new Error("Invalid leaderboard");
  return data.map((item: unknown) => {
    if (!isObject(item) || typeof item.rank !== "number") throw new Error("Invalid leaderboard entry");
    return { rank: item.rank, user: parseUserPublic(item.user), rating: parseRating(item.rating) };
  });
}

export function parseUserProfile(data: unknown): UserProfile {
  if (!isObject(data) || !Array.isArray(data.ratings) || typeof data.is_friend !== "boolean" || typeof data.is_blocked !== "boolean"
    || !isFriendRequestState(data.friend_request) || typeof data.points !== "number" || typeof data.streak !== "number" || !(data.rank === null || typeof data.rank === "number")) {
    throw new Error("Invalid profile");
  }
  if (typeof data.read_blocked !== "boolean") throw new Error("Invalid profile");
  // When `read_blocked`, only `id`, `tag`, and `is_blocked` describe the player; the rest are blanks.
  return { ...parseUserPublic(data), ratings: data.ratings.map(parseRating), read_blocked: data.read_blocked, is_friend: data.is_friend, friend_request: data.friend_request, points: data.points, streak: data.streak, rank: data.rank, is_blocked: data.is_blocked,
    score_averages: data.read_blocked ? null : parseScoreAverages(data.score_averages) };
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

export const JUDGE_CATEGORIES = ["argument_quality", "support_for_claims", "weighing_and_persuasiveness", "clarity_and_structure"] as const;
export const MAX_CATEGORY_SCORE = 5;
export const MAX_TOTAL_SCORE = MAX_CATEGORY_SCORE * JUDGE_CATEGORIES.length;
export type JudgeCategory = typeof JUDGE_CATEGORIES[number];
type CategoryScore = Record<Side, number>;
export type Scorecard = Record<JudgeCategory, CategoryScore>;
export type ScoreAverages = { match_count: number; total: number; categories: Record<JudgeCategory, number> };

function isScore(data: unknown, max: number): data is number {
  return typeof data === "number" && Number.isFinite(data) && data >= 0 && data <= max;
}

function parseCategoryValues<T>(data: unknown, parse: (value: unknown) => T): Record<JudgeCategory, T> {
  if (!isObject(data)) throw new Error("Invalid judging categories");
  return Object.fromEntries(JUDGE_CATEGORIES.map(category => [category, parse(data[category])])) as Record<JudgeCategory, T>;
}

function parseScorecard(data: unknown): Scorecard | null {
  if (data === null || data === undefined) return null;
  return parseCategoryValues(data, value => {
    if (!isObject(value) || !isScore(value.pro, MAX_CATEGORY_SCORE) || !Number.isInteger(value.pro)
      || !isScore(value.con, MAX_CATEGORY_SCORE) || !Number.isInteger(value.con)) {
      throw new Error("Invalid category score");
    }
    return { pro: value.pro, con: value.con };
  });
}

function parseScoreAverages(data: unknown): ScoreAverages | null {
  if (data === null || data === undefined) return null;
  if (!isObject(data) || typeof data.match_count !== "number" || !Number.isSafeInteger(data.match_count) || data.match_count < 1
    || !isScore(data.total, MAX_TOTAL_SCORE)) throw new Error("Invalid score averages");
  return {
    match_count: data.match_count,
    total: data.total,
    categories: parseCategoryValues(data.categories, value => {
      if (!isScore(value, MAX_CATEGORY_SCORE)) throw new Error("Invalid category average");
      return value;
    }),
  };
}

// A player's public profile and Elo on this ladder, before and after sides are assigned.
export type ArenaParticipant = { user_id: string; user: UserPublic | null; elo: number | null };
export type ArenaPlayer = ArenaParticipant & { side: Side };
// Each side's Elo around the match, from MATCH_RESULT; null when ratings didn't change or aren't saved yet.
export type ArenaRatingChange = { user_id: string; side: Side; elo_before: number | null; elo_after: number | null };
export type ArenaResult = {
  winner: Side | null;
  reason: string;
  scorecard: Scorecard | null;
  status: "completed" | "forfeited" | "voided";
  end_reason: "judged" | "no_show" | "no_prompt" | "resigned" | "model_failure" | "judge_failure";
  arguments: Record<Side, string>;
  participants: ArenaRatingChange[];
};
export type MatchState = { model_display_name: string; topic: ArenaTopic; you: Side; deadline: string | null; challenge: MatchChallenge | null; participants: ArenaPlayer[] };
export type SideSelectionState = { match_id: string; model_display_name: string; topic: ArenaTopic; deadline: string };
export type MatchMessage =
  | { type: "SIDE_SELECTION_OPEN"; payload: SideSelectionState }
  | { type: "MATCH_INTRO" | "MATCH_STATE"; payload: MatchState }
  | { type: "TURN_DELTA"; payload: { delta: string } }
  | { type: "TURN_END" | "JUDGING"; payload: Record<string, unknown> }
  | { type: "MATCH_RESULT"; payload: ArenaResult }
  | { type: "HEARTBEAT"; payload: Record<string, unknown> }
  | { type: "ERROR"; payload: { code: string; message: string } };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function side(value: unknown): value is Side { return value === "pro" || value === "con"; }
function nullableNumber(value: unknown): value is number | null { return value === null || (typeof value === "number" && Number.isFinite(value)); }
function arenaTopic(value: unknown): value is ArenaTopic {
  return record(value) && typeof value.topic === "string" && typeof value.pro_position === "string" && typeof value.con_position === "string";
}
function deadline(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

// `participants` arrived after the first arena release, so a message without it is still valid.
function parseList<T>(value: unknown, item: (entry: Record<string, unknown> & { user_id: string }) => T): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Invalid participants");
  return value.map((entry: unknown) => {
    if (!record(entry) || typeof entry.user_id !== "string") throw new Error("Invalid participant");
    return item({ ...entry, user_id: entry.user_id });
  });
}

function parseArenaParticipant(entry: Record<string, unknown> & { user_id: string }): ArenaParticipant {
  if (!(entry.elo === undefined || nullableNumber(entry.elo))) throw new Error("Invalid participant");
  return { user_id: entry.user_id, user: entry.user == null ? null : parseUserPublic(entry.user), elo: entry.elo ?? null };
}

function parseArenaPlayers(value: unknown): ArenaPlayer[] {
  return parseList(value, (entry) => {
    if (!side(entry.side)) throw new Error("Invalid participant");
    return { ...parseArenaParticipant(entry), side: entry.side };
  });
}

function parseRatingChanges(value: unknown): ArenaRatingChange[] {
  return parseList(value, (entry) => {
    if (!side(entry.side) || !nullableNumber(entry.elo_before) || !nullableNumber(entry.elo_after)) throw new Error("Invalid participant");
    return { user_id: entry.user_id, side: entry.side, elo_before: entry.elo_before, elo_after: entry.elo_after };
  });
}

export function parseMatchMessage(raw: string): MatchMessage {
  const data: unknown = JSON.parse(raw);
  if (!record(data) || !record(data.payload)) throw new Error("Invalid match message");
  const p = data.payload;
  switch (data.type) {
    case "SIDE_SELECTION_OPEN":
      if (typeof p.match_id === "string" && typeof p.model_display_name === "string" && p.model_display_name.trim()
        && arenaTopic(p.topic) && deadline(p.deadline)) {
        return { type: data.type, payload: { match_id: p.match_id, model_display_name: p.model_display_name,
          topic: p.topic, deadline: p.deadline } };
      }
      break;
    case "MATCH_INTRO": case "MATCH_STATE":
      if (typeof p.model_display_name === "string" && p.model_display_name.trim() && arenaTopic(p.topic) && side(p.you)
        && (p.deadline === null || (data.type === "MATCH_STATE" && deadline(p.deadline)))) {
        return { type: data.type, payload: { model_display_name: p.model_display_name, topic: p.topic, you: p.you, deadline: p.deadline, challenge: parseChallenge(p.challenge), participants: parseArenaPlayers(p.participants) } };
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
        && ["judged", "no_show", "no_prompt", "resigned", "model_failure", "judge_failure"].includes(String(p.end_reason))
        && record(p.arguments) && typeof p.arguments.pro === "string" && typeof p.arguments.con === "string") {
        return { type: data.type, payload: {
          winner: p.winner, reason: p.reason, status: p.status as ArenaResult["status"], end_reason: p.end_reason as ArenaResult["end_reason"],
          arguments: { pro: p.arguments.pro, con: p.arguments.con }, participants: parseRatingChanges(p.participants),
          scorecard: p.status === "completed" && p.end_reason === "judged" ? parseScorecard(p.scorecard) : null,
        } };
      }
      break;
    case "ERROR":
      if (typeof p.code === "string" && typeof p.message === "string") return { type: data.type, payload: { code: p.code, message: p.message } };
  }
  throw new Error("Invalid match message");
}

// BILC pairing and devices (PROTOCOL.md, "REST — web client").
export type PairingCode = { code: string; expires_at: string };

export function parsePairingCode(data: unknown): PairingCode {
  if (!isObject(data) || typeof data.code !== "string" || typeof data.expires_at !== "string") throw new Error("Invalid pairing code");
  return { code: data.code, expires_at: data.expires_at };
}

export type SizeClass = "small" | "medium" | "large";
export type DeviceStatus = "offline" | "idle" | "busy";
export type BilcDevice = {
  id: string; name: string; platform: string; client_version: string; model_name: string | null;
  size_class: SizeClass | null; online: boolean; status: DeviceStatus; last_seen_at: string | null; created_at: string;
};

// PROTOCOL.md, "BYOM arena": classes by the model's parameter count.
export const SIZE_CLASS_LABELS: Record<SizeClass, string> = { small: "under 8B", medium: "8B–30B", large: "over 30B" };

export function parseBilcDevices(data: unknown): BilcDevice[] {
  if (!Array.isArray(data)) throw new Error("Invalid device list");
  return data.map((item) => {
    if (!isObject(item) || [item.id, item.name, item.platform, item.client_version, item.created_at].some((value) => typeof value !== "string")
      || typeof item.online !== "boolean" || !(item.model_name === null || typeof item.model_name === "string")
      || !(item.size_class === null || ["small", "medium", "large"].includes(item.size_class as string))
      || !["offline", "idle", "busy"].includes(item.status as string)
      || !(item.last_seen_at === null || typeof item.last_seen_at === "string")) {
      throw new Error("Invalid device");
    }
    return item as BilcDevice;
  });
}

// Match history (PROTOCOL.md, "Shared types").
export type MatchOutcome = "win" | "loss" | "void";
export type MatchParticipant = { side: Side; user: UserPublic | null; elo_before: number | null; elo_after: number | null };
export type MatchSummary = {
  id: string; topic: string | null; status: "completed" | "forfeited" | "voided"; winner_side: Side | null; end_reason: string;
  challenge_day: string | null; you: Side; outcome: MatchOutcome; model: string | null; participants: MatchParticipant[]; ended_at: string;
};
export type MatchTurn = { id: string; index: number; side: Side; phase: string; content: string; truncated: boolean };
export type MatchDetail = MatchSummary & { pro_position: string | null; con_position: string | null; verdict_reasoning: string | null; scorecard: Scorecard | null; turns: MatchTurn[] };

function isSide(value: unknown): value is Side {
  return value === "pro" || value === "con";
}

function optionalNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

function parseMatchParticipant(data: unknown): MatchParticipant {
  if (!isObject(data) || !isSide(data.side) || !optionalNumber(data.elo_before) || !optionalNumber(data.elo_after)) throw new Error("Invalid participant");
  return { side: data.side, user: data.user === null ? null : parseUserPublic(data.user), elo_before: data.elo_before, elo_after: data.elo_after };
}

function parseMatchSummary(data: unknown): MatchSummary {
  if (!isObject(data) || typeof data.id !== "string" || !optionalString(data.topic)
    || !["completed", "forfeited", "voided"].includes(String(data.status)) || !(data.winner_side === null || isSide(data.winner_side))
    || typeof data.end_reason !== "string" || !optionalString(data.challenge_day) || !isSide(data.you)
    || !["win", "loss", "void"].includes(String(data.outcome)) || !optionalString(data.model)
    || !Array.isArray(data.participants) || typeof data.ended_at !== "string") {
    throw new Error("Invalid match");
  }
  return {
    id: data.id, topic: data.topic, status: data.status as MatchSummary["status"], winner_side: data.winner_side, end_reason: data.end_reason,
    challenge_day: data.challenge_day, you: data.you, outcome: data.outcome as MatchOutcome, model: data.model,
    participants: data.participants.map(parseMatchParticipant), ended_at: data.ended_at,
  };
}

export function parseMatchPage(data: unknown): { items: MatchSummary[]; next_offset: number | null } {
  if (!isObject(data) || !Array.isArray(data.items) || !optionalNumber(data.next_offset)) throw new Error("Invalid match page");
  return { items: data.items.map(parseMatchSummary), next_offset: data.next_offset };
}

export function parseMatchDetail(data: unknown): MatchDetail {
  if (!isObject(data) || !optionalString(data.pro_position) || !optionalString(data.con_position)
    || !optionalString(data.verdict_reasoning) || !Array.isArray(data.turns)) {
    throw new Error("Invalid match");
  }
  return {
    ...parseMatchSummary(data), pro_position: data.pro_position, con_position: data.con_position, verdict_reasoning: data.verdict_reasoning,
    scorecard: data.status === "completed" && data.end_reason === "judged" ? parseScorecard(data.scorecard) : null,
    turns: data.turns.map((turn: unknown) => {
      if (!isObject(turn) || typeof turn.id !== "string" || typeof turn.index !== "number" || !isSide(turn.side)
        || typeof turn.phase !== "string" || typeof turn.content !== "string" || typeof turn.truncated !== "boolean") {
        throw new Error("Invalid turn");
      }
      return { id: turn.id, index: turn.index, side: turn.side, phase: turn.phase, content: turn.content, truncated: turn.truncated };
    }),
  };
}

export type AdminTopic = {
  id: string; category: string; topic: string; pro_position: string; con_position: string; is_active: boolean; created_at: string;
};
export type AdminTopicsPage = { total: number; topics: AdminTopic[] };
export type TopicUploadResult = { added: number; skipped: number };

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function parseAdminTopicsPage(data: unknown): AdminTopicsPage {
  if (!isObject(data) || !isCount(data.total) || !Array.isArray(data.topics)
    || !data.topics.every(topic => isObject(topic)
      && [topic.id, topic.category, topic.topic, topic.pro_position, topic.con_position, topic.created_at].every(value => typeof value === "string")
      && typeof topic.is_active === "boolean")) {
    throw new Error("Invalid topics page");
  }
  return data as AdminTopicsPage;
}

export function parseTopicUploadResult(data: unknown): TopicUploadResult {
  if (!isObject(data) || !isCount(data.added) || !isCount(data.skipped)) throw new Error("Invalid upload result");
  return { added: data.added, skipped: data.skipped };
}
