import { test, expect, type WebSocketRoute } from "@playwright/test";
import { cleanupAccounts, account, submit } from "./helpers";

test.afterEach(cleanupAccounts);

const matchId = "33333333-3333-4333-8333-333333333333";
const initial = { type: "MATCH_STATE", payload: { model_display_name: "Controlled model", topic: { category: "T", topic: "Controlled topic", pro_position: "P", con_position: "C" }, you: "pro", deadline: new Date(Date.now() + 120000).toISOString(), challenge: null } };
const result = { type: "MATCH_RESULT", payload: { winner: "pro", reason: "Saved result", status: "completed", end_reason: "judged", arguments: { pro: "literal", con: "other" } } };

test("one socket in Strict Mode, rejected prompts can retry, heartbeat echoes, result survives closure", async ({ page, context }) => {
  await account(context);
  let socket: WebSocketRoute;
  let opened = 0;
  const received: { type: string; payload: unknown }[] = [];
  await page.routeWebSocket("**/v1/game/**", ws => {
    opened++;
    socket = ws;
    ws.onMessage(message => { received.push(JSON.parse(String(message))); });
    ws.send(JSON.stringify(initial));
  });
  await page.goto(`/match/${matchId}`);
  await submit(page);
  await expect.poll(() => received.filter(m => m.type === "SUBMIT_PROMPT").length).toBe(1);
  socket!.send(JSON.stringify({ type: "ERROR", payload: { code: "PROMPT_BREAKS_CHALLENGE", message: "Edit and retry" } }));
  await expect(page.locator("textarea")).toBeVisible();
  await submit(page, "Revised strategy");
  await expect.poll(() => received.filter(m => m.type === "SUBMIT_PROMPT").length).toBe(2);
  const heartbeat = { type: "HEARTBEAT", payload: { ts: 12345 } };
  socket!.send(JSON.stringify(heartbeat));
  await expect.poll(() => received.some(m => JSON.stringify(m) === JSON.stringify(heartbeat))).toBe(true);
  socket!.send(JSON.stringify({ type: "TURN_DELTA", payload: { delta: "**literal** <script>window.bad=true</script>" } }));
  await expect(page.getByText("**literal** <script>window.bad=true</script>", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => "bad" in window)).toBe(false);
  socket!.send(JSON.stringify({ type: "TURN_END", payload: {} }));
  await expect(page.getByText("Waiting for your opponent…", { exact: true })).toBeVisible();
  socket!.send(JSON.stringify({ type: "JUDGING", payload: {} }));
  await expect(page.getByText("Waiting for the verdict…", { exact: true })).toBeVisible();
  socket!.send(JSON.stringify(result));
  await expect(page.getByText("Saved result", { exact: true })).toBeVisible();
  await socket!.close();
  await expect(page.getByText("Saved result", { exact: true })).toBeVisible();
  expect(opened).toBe(1);
});

test("malformed socket updates show an actionable error", async ({ page, context }) => {
  await account(context);
  await page.routeWebSocket("**/v1/game/**", ws => ws.send("not JSON"));
  await page.goto(`/match/${matchId}`);
  await expect(page.locator("p[role=alert]")).toContainText(/debate update|connection was lost/);
  await expect(page.getByRole("link", { name: "Back to lobby", exact: true })).toBeVisible();
});

test("leaving resigns once and navigates after the result", async ({ page, context }) => {
  await account(context);
  let resignations = 0;
  await page.routeWebSocket("**/v1/game/**", ws => {
    ws.send(JSON.stringify(initial));
    ws.onMessage(message => {
      if (JSON.parse(String(message)).type === "RESIGN") {
        resignations++;
        ws.send(JSON.stringify({ ...result, payload: { ...result.payload, winner: "con", status: "forfeited", end_reason: "resigned" } }));
      }
    });
  });
  await page.goto(`/match/${matchId}`);
  await expect(page.locator("textarea")).toBeVisible();
  await page.getByRole("button", { name: /leave|lobby/i }).click();
  await page.getByRole("button", { name: "Forfeit and leave", exact: true }).click();
  await expect(page).toHaveURL("/");
  expect(resignations).toBe(1);
});

test("unmount closes the socket and heartbeat silence becomes an error", async ({ page, context }) => {
  await account(context);
  await page.clock.install();
  let opened = 0;
  const closed = new Set<WebSocketRoute>();
  await page.routeWebSocket("**/v1/game/**", ws => {
    opened++;
    ws.onClose(() => { closed.add(ws); void ws.close(); });
    ws.send(JSON.stringify(initial));
  });
  await page.goto(`/match/${matchId}`);
  await expect(page.locator("textarea")).toBeVisible();
  await page.clock.fastForward(45001);
  await expect(page.locator("p[role=alert]")).toContainText("connection was lost");
  expect(closed.size).toBe(opened);
  await page.goto("/matches");
  expect(closed.size).toBe(opened);
});
