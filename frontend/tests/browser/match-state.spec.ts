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
  const editor = page.getByRole("textbox", { name: "Give your AI a strategy" });
  const submitButton = page.getByRole("button", { name: "Submit prompt" });
  await editor.fill("Use concrete evidence.");
  await submitButton.press("Enter");
  await expect(page.getByRole("heading", { name: "Your AI’s argument" })).toBeFocused();
  await expect.poll(() => received.filter(m => m.type === "SUBMIT_PROMPT").length).toBe(1);
  socket!.send(JSON.stringify({ type: "ERROR", payload: { code: "PROMPT_BREAKS_CHALLENGE", message: "Edit and retry" } }));
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue("Use concrete evidence.");
  await expect(editor).toHaveAccessibleDescription(/Edit and retry/);
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
  await expect(page.getByRole("heading", { name: "You won." })).toBeFocused();
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

test("a phone can reach the timed prompt controls and see judging while reading a long argument", async ({ page, context }) => {
  await account(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  let socket: WebSocketRoute;
  await page.routeWebSocket("**/v1/game/**", ws => {
    socket = ws;
    ws.send(JSON.stringify({ ...initial, payload: {
      ...initial.payload,
      topic: { category: "Cities", topic: "Should public transit be free for every passenger in a large city?", pro_position: "Everyone should be able to use public transit regardless of their ability to pay the fare.", con_position: "Cities need fares to maintain their transit systems." },
      challenge: { title: "Keep it short", description: "Write a strategy with 120 characters or fewer.", max_chars: 120 },
    } }));
  });
  await page.goto(`/match/${matchId}`);
  const editor = page.getByRole("textbox", { name: "Give your AI a strategy" });
  await expect(editor).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("timer")).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("button", { name: "Submit prompt" })).toBeInViewport({ ratio: 1 });
  await expect(editor).toHaveAccessibleDescription(/Write a strategy with 120 characters or fewer/);
  await submit(page);
  const argument = "A long argument about public transit. ".repeat(80).trim();
  socket!.send(JSON.stringify({ type: "TURN_DELTA", payload: { delta: argument } }));
  await expect(page.getByText(argument, { exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(200);
  socket!.send(JSON.stringify({ type: "JUDGING", payload: {} }));
  const phase = page.getByRole("banner").getByRole("status");
  await expect(phase).toHaveText("Waiting for the verdict…");
  await expect(phase).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(200);
});

test("a no-show outcome is visible before either side or topic is announced", async ({ page, context }) => {
  await account(context);
  await page.routeWebSocket("**/v1/game/**", ws => ws.send(JSON.stringify({ ...result, payload: {
    ...result.payload, winner: "con", status: "forfeited", end_reason: "no_show", reason: "The opponent did not join in time.",
  } })));
  await page.goto(`/match/${matchId}`);
  await expect(page.getByRole("heading", { name: "You won.", level: 1 })).toBeFocused();
  await expect(page.getByText("The opponent did not join in time.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to lobby", exact: true })).toBeVisible();
});

test("a server-confirmed deadline keeps the draft available to copy", async ({ page, context }) => {
  await account(context);
  await page.routeWebSocket("**/v1/game/**", ws => {
    ws.send(JSON.stringify(initial));
    ws.onMessage(message => {
      if (JSON.parse(String(message)).type === "SUBMIT_PROMPT") {
        ws.send(JSON.stringify({ type: "ERROR", payload: { code: "PROMPT_DEADLINE_PASSED", message: "The prompt window has closed." } }));
      }
    });
  });
  await page.goto(`/match/${matchId}`);
  await submit(page);
  await expect(page.getByRole("banner").getByRole("status")).toHaveText("Prompt window closed");
  const editor = page.getByRole("textbox", { name: "Give your AI a strategy" });
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue("Use concrete evidence.");
  await expect(editor).not.toBeEditable();
  await expect(page.getByRole("button", { name: "Submit prompt" })).toBeDisabled();
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
  const leave = page.getByRole("button", { name: "Leave debate…" });
  await leave.press("Enter");
  await expect(page.getByRole("dialog", { name: "Leave and forfeit?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(leave).toBeFocused();
  await leave.press("Enter");
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
