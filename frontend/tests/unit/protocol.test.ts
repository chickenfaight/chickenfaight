import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node executes the TypeScript source directly; Next disallows .ts imports.
import { parseMatchMessage, parseQueueStatus, parseArenaStats } from "../../app/lib/protocol.ts";

const state = { type: "MATCH_STATE", payload: { model_display_name: "Test", topic: { category: "T", topic: "Topic", pro_position: "P", con_position: "C" }, you: "pro", deadline: "2026-11-15T12:00:00Z", challenge: null } };
test("match parser accepts every implemented message", () => {
  for (const message of [state, { type: "TURN_DELTA", payload: { delta: "<script>literal</script>" } },
    ...["TURN_END", "JUDGING", "HEARTBEAT"].map(type => ({ type, payload: {} })),
    { type: "ERROR", payload: { code: "BAD_MESSAGE", message: "Try again" } },
    ...["judged", "no_show", "no_prompt", "resigned", "model_failure", "judge_failure"].map(end_reason => ({ type: "MATCH_RESULT", payload: { winner: null, reason: "Done", status: "voided", end_reason, arguments: { pro: "P", con: "C" } } }))]) {
    assert.equal(parseMatchMessage(JSON.stringify(message)).type, message.type);
  }
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
  assert.deepEqual(parseQueueStatus({ status: "queued" }), { status: "queued" });
  assert.throws(() => parseQueueStatus({ status: "matched" }));
  assert.throws(() => parseQueueStatus({ status: "unknown" }));
});
test("stats reject impossible totals and rates", () => {
  const empty = { points: 0, debates_played: 0, wins: 0, win_rate: null, recent_form: [] };
  assert.deepEqual(parseArenaStats(empty), empty);
  for (const bad of [{ points: -1 }, { win_rate: 101 }, { wins: 1.5 }, { recent_form: ["X"] }]) {
    assert.throws(() => parseArenaStats({ ...empty, ...bad }));
  }
});
