import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { account, cleanupAccounts, modelId, selectModel } from "./helpers";

// Audit settled UI rather than intermediate opacity during entrance animations.
test.use({ reducedMotion: "reduce" });

// Firefox 1.65.1 repeatedly crashes inside axe's frame.evaluate on the lobby.
// Its keyboard/menu behavior remains covered by homepage.spec.ts.
test.beforeEach(({ browserName }) => {
  test.skip(browserName === "firefox", "Firefox crashes during axe frame evaluation; retain Chromium/WebKit audits");
});
test.afterEach(cleanupAccounts);

async function audit(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations).toEqual([]);
}

test("sign-in form passes automated accessibility checks", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator('input[type="password"]')).toBeVisible();
  await audit(page);
});

test("account settings and username editor pass accessibility checks", async ({ page, context }) => {
  await account(context);
  await page.goto("/settings");
  const edit = page.getByRole("button", { name: /edit username/i });
  await expect(edit).toBeVisible();
  await audit(page);
  await edit.press("Enter");
  await expect(page.getByRole("textbox", { name: "Username", exact: true })).toBeFocused();
  await audit(page);
  await page.keyboard.press("Escape");
  await expect(edit).toBeFocused();
});

test("lobby and open model picker pass accessibility checks", async ({ page, context }) => {
  await account(context);
  await page.goto("/");
  await selectModel(page, modelId);
  await audit(page);
  const picker = page.getByRole("combobox", { name: "AI model", exact: true });
  await picker.focus();
  await picker.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await audit(page);
  await picker.press("Escape");
  await expect(picker).toBeFocused();
});

test("the mobile side chooser, matchup reveal, match editor, and verdict pass automated accessibility checks", async ({ page, context }) => {
  await account(context);
  await page.setViewportSize({ width: 390, height: 844 });
  let socket: import("@playwright/test").WebSocketRoute;
  const topic = { category: "Cities", topic: "Should public transit be free?", pro_position: "Transit should be free.", con_position: "Transit should not be free." };
  const matchId = "33333333-3333-4333-8333-333333333333";
  await page.routeWebSocket("**/v1/game/**", ws => {
    socket = ws;
    ws.send(JSON.stringify({ type: "SIDE_SELECTION_OPEN", payload: {
      match_id: matchId, model_display_name: "Test model", topic, deadline: new Date(Date.now() + 15000).toISOString(),
    } }));
  });
  await page.goto(`/match/${matchId}`);
  await expect(page.getByRole("heading", { name: "Choose your side" })).toBeVisible();
  await audit(page);
  socket!.send(JSON.stringify({ type: "MATCH_INTRO", payload: {
    match_id: matchId, model_display_name: "Test model", topic, you: "pro", deadline: null, challenge: null,
  } }));
  await expect(page.getByRole("heading", { name: "Your side · Pro", level: 1 })).toBeVisible();
  await audit(page);
  socket!.send(JSON.stringify({ type: "MATCH_STATE", payload: {
    match_id: matchId, model_display_name: "Test model", topic,
    you: "pro", deadline: new Date(Date.now() + 120000).toISOString(), challenge: null,
  } }));
  await expect(page.getByRole("textbox", { name: "Give your AI a strategy" })).toBeVisible();
  await audit(page);
  socket!.send(JSON.stringify({ type: "MATCH_RESULT", payload: {
    winner: "pro", reason: "The judge preferred the argument for free public transit.", status: "completed", end_reason: "judged",
    arguments: { pro: "Free transit improves access to work.", con: "Transit requires sustainable funding." },
  } }));
  await expect(page.getByRole("heading", { name: "You won." })).toBeFocused();
  await audit(page);
});
