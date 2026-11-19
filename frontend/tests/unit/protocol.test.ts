import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node executes the TypeScript source directly; Next disallows .ts imports.
import { parseMatchMessage, parseQueueStatus, parseArenaStats } from "../../app/lib/protocol.ts";

const state = { type: "MATCH_STATE", payload: { model_display_name: "Test", topic: { category: "T", topic: "Topic", pro_position: "P", con_position: "C" }, you: "pro", deadline: "2026-11-15T12:00:00Z", challenge: null } };
const selection = { type: "SIDE_SELECTION_OPEN", payload: {
  match_id: "33333333-3333-4333-8333-333333333333", model_display_name: "Test", topic: state.payload.topic,
  deadline: "2026-11-15T11:58:00Z",
} };
const intro = { type: "MATCH_INTRO", payload: { ...state.payload, deadline: null } };
test("match parser accepts every implemented message", () => {
  for (const message of [state, intro, selection, { type: "TURN_DELTA", payload: { delta: "<script>literal</script>" } },
    ...["TURN_END", "JUDGING", "HEARTBEAT"].map(type => ({ type, payload: {} })),
    { type: "ERROR", payload: { code: "BAD_MESSAGE", message: "Try again" } },
    ...["judged", "no_show", "no_prompt", "resigned", "model_failure", "judge_failure"].map(end_reason => ({ type: "MATCH_RESULT", payload: { winner: null, reason: "Done", status: "voided", end_reason, arguments: { pro: "P", con: "C" } } }))]) {
    assert.equal(parseMatchMessage(JSON.stringify(message)).type, message.type);
  }
});
test("selection carries a deadline but exposes no players and the reveal starts no prompt timer", () => {
  const withPlayers = { ...selection, payload: { ...selection.payload, participants: [{ user_id: "u1" }] } };
  assert.deepEqual(parseMatchMessage(JSON.stringify(withPlayers)), selection);
  assert.throws(() => parseMatchMessage(JSON.stringify({ ...selection, payload: { ...selection.payload, deadline: null } })));
  assert.throws(() => parseMatchMessage(JSON.stringify({ ...intro, payload: state.payload })));
});
test("invalid match payloads fail closed", () => {
  for (const message of [null, [], {}, { type: "UNKNOWN", payload: {} },
    { ...state, payload: { ...state.payload, deadline: "yesterday" } },
    { ...state, payload: { ...state.payload, you: "other" } },
    { type: "TURN_DELTA", payload: { delta: 1 } },
    { type: "MATCH_RESULT", payload: { winner: "pro", reason: "x", status: "completed", end_reason: "judged", arguments: {} } }]) {
    assert.throws(() => parseMatchMessage(JSON.stringify(message)));
  }
  assert.throws(() => parseMatchMessage("not JSON"));
});
test("queue status needs a match id only when matched", () => {
  assert.deepEqual(parseQueueStatus({ status: "none" }), { status: "none" });
  assert.deepEqual(parseQueueStatus({ status: "queued" }), { status: "queued", queue: null });
  assert.throws(() => parseQueueStatus({ status: "matched" }));
  assert.throws(() => parseQueueStatus({ status: "unknown" }));
});
test("queue metadata validates the mode, original join time, and elapsed seconds", () => {
  const queue = {
    mode: "daily", model_id: "11111111-1111-4111-8111-111111111111", model_display_name: "Test model",
    joined_at: "2026-11-18T00:00:00Z", elapsed_seconds: 45,
  };
  assert.deepEqual(parseQueueStatus({ status: "queued", queue }), { status: "queued", queue });
  const quick = { ...queue, mode: "quick", model_id: null, model_display_name: null };
  assert.deepEqual(parseQueueStatus({ status: "queued", queue: quick }), { status: "queued", queue: quick });
  for (const invalid of [{ mode: "competitive" }, { model_id: 1 }, { joined_at: "yesterday" }, { elapsed_seconds: -1 }, { elapsed_seconds: 0.5 }]) {
    assert.throws(() => parseQueueStatus({ status: "queued", queue: { ...queue, ...invalid } }));
  }
  assert.throws(() => parseQueueStatus({ status: "queued", queue: null }));
});
test("stats reject impossible totals and rates", () => {
  const empty = { points: 0, debates_played: 0, wins: 0, win_rate: null, recent_form: [] };
  assert.deepEqual(parseArenaStats(empty), empty);
  for (const bad of [{ points: -1 }, { win_rate: 101 }, { wins: 1.5 }, { recent_form: ["X"] }]) {
    assert.throws(() => parseArenaStats({ ...empty, ...bad }));
  }
});
test("arena participants are optional and carry players and Elo when sent", () => {
  const user = { id: "u1", tag: "rooster", username: "Rooster", avatar_url: null };
  const parsed = parseMatchMessage(JSON.stringify({ ...state, payload: { ...state.payload, participants: [
    { user_id: "u1", side: "pro", user, elo: 1016 }, { user_id: "u2", side: "con", user: null, elo: null },
  ] } }));
  assert.equal(parsed.type, "MATCH_STATE");
  if (parsed.type !== "MATCH_STATE") return;
  assert.deepEqual(parsed.payload.participants, [{ user_id: "u1", side: "pro", user, elo: 1016 }, { user_id: "u2", side: "con", user: null, elo: null }]);
  const older = parseMatchMessage(JSON.stringify(state));
  assert.deepEqual(older.type === "MATCH_STATE" && older.payload.participants, []);

  const result = { winner: "pro", reason: "x", status: "completed", end_reason: "judged", arguments: { pro: "P", con: "C" } };
  const rated = parseMatchMessage(JSON.stringify({ type: "MATCH_RESULT", payload: { ...result, participants: [
    { user_id: "u1", side: "pro", elo_before: 1000, elo_after: 1016 }, { user_id: "u2", side: "con", elo_before: null, elo_after: null },
  ] } }));
  assert.deepEqual(rated.type === "MATCH_RESULT" && rated.payload.participants.map(p => p.elo_after), [1016, null]);
  for (const participants of [{}, [{ user_id: "u1", side: "other" }], [{ user_id: "u1", side: "pro", elo_before: "1000", elo_after: 1016 }]]) {
    assert.throws(() => parseMatchMessage(JSON.stringify({ type: "MATCH_RESULT", payload: { ...result, participants } })));
  }
  assert.throws(() => parseMatchMessage(JSON.stringify({ ...state, payload: { ...state.payload, participants: [{ user_id: "u1", side: "pro", user: { id: 1 }, elo: 1 }] } })));
});
