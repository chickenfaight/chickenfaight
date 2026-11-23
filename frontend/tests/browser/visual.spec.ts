import { test, expect } from "@playwright/test";
import { account, cleanupAccounts, modelId, selectModel, verdictScores } from "./helpers";

test.afterEach(cleanupAccounts);

test("lobby and picker", async ({ page, context }) => {
  const me = await account(context);
  await page.clock.setFixedTime(new Date("2026-11-17T12:00:00Z"));
  await page.route("**/v1/challenge/today", route => route.fulfill({ json: {
    day: "2026-11-17", topic: { topic: "Should public transit be free?", pro_position: "Yes", con_position: "No" },
    twist: { title: "Be concrete", description: "Use one concrete example.", max_chars: null },
    reward_points: 50, completed: false, resets_at: "2026-11-18T00:00:00Z",
  } }));
  await page.goto("/");
  await selectModel(page, modelId);
  await expect(page.getByText("Use one concrete example.", { exact: true })).toBeVisible();
  const mask = [page.getByRole("button", { name: me.tag, exact: true })];
  await expect(page).toHaveScreenshot("lobby.png", { fullPage: true, mask });
  await page.getByRole("combobox", { name: "AI model", exact: true }).click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(page).toHaveScreenshot("model-picker.png", { fullPage: true, mask });
});

test("prompt editor and verdict", async ({ page, context }) => {
  await account(context);
  let socket: import("@playwright/test").WebSocketRoute;
  await page.clock.setFixedTime(new Date("2026-11-17T12:00:00Z"));
  await page.routeWebSocket("**/v1/game/**", ws => {
    socket = ws;
    ws.send(JSON.stringify({ type: "MATCH_STATE", payload: {
      model_display_name: "Controlled model", topic: { category: "Society", topic: "Should public transit be free?", pro_position: "Transit should be free.", con_position: "Transit should not be free." },
      participants: [{ user_id: "pro-player", side: "pro", user: { id: "pro-player", tag: "rooster", username: "Rooster", avatar_url: null }, elo: 1000 }, { user_id: "con-player", side: "con", user: { id: "con-player", tag: "challenger", username: "Challenger", avatar_url: null }, elo: 1000 }],
      you: "pro", deadline: "2026-11-17T12:02:00Z", challenge: null,
    } }));
  });
  await page.goto("/match/33333333-3333-4333-8333-333333333333");
  await expect(page.locator("textarea")).toBeVisible();
  await expect(page).toHaveScreenshot("prompt-editor.png", { fullPage: true });
  socket!.send(JSON.stringify({ type: "MATCH_RESULT", payload: {
    winner: "pro", reason: "The argument supported its claims with concrete evidence.", status: "completed", end_reason: "judged",
    arguments: { pro: "Free transit improves access to work.", con: "Transit requires sustainable funding." }, scorecard: verdictScores,
  } }));
  await expect(page.getByRole("heading", { name: "Judge’s scorecard" })).toBeVisible();
  await expect(page.getByText("The argument supported its claims with concrete evidence.", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("verdict.png", { fullPage: true });
});
