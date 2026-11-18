import { expect, test } from "@playwright/test";
import { account, backend, cleanupAccounts, modelId, selectModel } from "./helpers";

test.afterEach(cleanupAccounts);

function elapsed(value: string): number {
  const [minutes, seconds] = value.trim().split(":").map(Number);
  return minutes * 60 + seconds;
}

test("queue time persists across signed-in routes and reload", async ({ page, context }) => {
  await account(context);
  await page.goto("/");
  await selectModel(page);
  await page.getByRole("button", { name: "Find match", exact: true }).click();
  const lobbyTimer = page.getByRole("timer", { name: "Time in queue" });
  await expect.poll(async () => elapsed(await lobbyTimer.innerText())).toBeGreaterThan(0);
  const beforeNavigation = elapsed(await lobbyTimer.innerText());

  const navigation = page.getByRole("navigation", { name: "Sections", exact: true });
  await navigation.getByRole("link", { name: "Settings", exact: true }).press("Enter");
  await expect(page).toHaveURL("/settings");
  const indicator = page.getByRole("banner").getByRole("region", { name: "Matchmaking queue" });
  const trigger = indicator.getByRole("button", { name: /^In queue/ });
  const timer = indicator.getByRole("timer", { name: "Time in queue" });
  await expect(trigger.getByText("Test model", { exact: true })).toBeVisible();
  await expect(page.getByRole("timer", { name: "Time in queue" })).toHaveCount(1);
  await expect.poll(async () => elapsed(await timer.innerText())).toBeGreaterThan(beforeNavigation);
  const beforeReload = elapsed(await timer.innerText());

  await page.reload();
  await expect.poll(async () => elapsed(await timer.innerText())).toBeGreaterThanOrEqual(beforeReload);
  await trigger.click();
  await indicator.getByRole("button", { name: "Cancel queue", exact: true }).click();
  await expect(indicator).toHaveCount(0);
  expect(await (await context.request.get(`${backend}/v1/match/status`)).json()).toEqual({ status: "none" });
});

test("finding a match in Settings opens the arena", async ({ browser, page, context }) => {
  await account(context);
  const opponent = await browser.newContext();
  try {
    await account(opponent);
    await page.goto("/settings");
    // Enter the queue through the normal lobby, then leave it by client-side navigation.
    await page.getByRole("navigation", { name: "Sections", exact: true }).getByRole("link", { name: "Play", exact: true }).press("Enter");
    await expect(page).toHaveURL("/");
    await selectModel(page);
    await page.getByRole("button", { name: "Find match", exact: true }).click();
    await expect(page.getByRole("button", { name: "Cancel queue", exact: true })).toBeVisible();
    await page.getByRole("navigation", { name: "Sections", exact: true }).getByRole("link", { name: "Settings", exact: true }).press("Enter");
    await expect(page).toHaveURL("/settings");
    await expect(page.getByRole("region", { name: "Matchmaking queue" })).toBeVisible();

    const registered = await opponent.request.post(`${backend}/v1/match/queue`, { data: { model_id: modelId } });
    expect(registered.status()).toBe(202);
    await expect(page).toHaveURL(/\/match\/[0-9a-f-]+$/);
    await expect(page.getByRole("region", { name: "Matchmaking queue" })).toHaveCount(0);
  } finally {
    await opponent.close();
  }
});

test("the phone header keeps the queue details and recovery actions in one row", async ({ page, context }) => {
  await account(context);
  await page.setViewportSize({ width: 320, height: 740 });
  let fail = false;
  let cancelled = false;
  const queued = { status: "queued", queue: {
    mode: "daily", model_id: modelId, model_display_name: "Test model with a longer display name",
    joined_at: "2026-11-18T00:00:00Z", elapsed_seconds: 45,
  } };
  await page.route("**/v1/match/status", route => route.fulfill(fail
    ? { status: 503, json: { detail: "offline" } }
    : { json: cancelled ? { status: "none" } : queued }));
  await page.route("**/v1/match/queue", async route => {
    expect(route.request().method()).toBe("DELETE");
    cancelled = true;
    await route.fulfill({ status: 204 });
  });
  await page.goto("/settings");
  const header = page.getByRole("banner");
  const indicator = header.getByRole("region", { name: "Matchmaking queue" });
  const active = indicator.getByRole("button", { name: /^Daily queue/ });
  const arena = "Test model with a longer display name";
  await expect(active.getByText(arena, { exact: true })).toBeVisible();
  await expect.poll(async () => elapsed(await indicator.getByRole("timer").innerText())).toBeGreaterThanOrEqual(45);
  await expect(active).toBeInViewport({ ratio: 1 });
  await expect(header.getByRole("button", { name: "Search players" })).toBeInViewport({ ratio: 1 });
  const contentTop = await page.locator("#main-content").evaluate(element => element.getBoundingClientRect().top + scrollY);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

  fail = true;
  const issue = indicator.getByRole("button", { name: /^Queue issue/ });
  await expect(issue).toBeVisible();
  await issue.press("Enter");
  await expect(indicator.getByText(`Daily challenge · ${arena}`, { exact: true })).toBeVisible();
  await expect(indicator.getByRole("button", { name: "Retry queue status" })).toBeVisible();
  await indicator.getByRole("button", { name: "Cancel queue", exact: true }).click();
  await expect(indicator).toHaveCount(0);
  expect(await page.locator("#main-content").evaluate(element => element.getBoundingClientRect().top + scrollY)).toBe(contentTop);
  expect(cancelled).toBe(true);
});

test("returning from a disconnected arena waits for its assignment to clear", async ({ page, context }) => {
  await account(context);
  const matchId = "33333333-3333-4333-8333-333333333333";
  let ended = false;
  await page.route("**/v1/match/status", route => route.fulfill({ json: ended
    ? { status: "none" }
    : { status: "matched", match_id: matchId } }));
  await page.routeWebSocket("**/v1/game/**", socket => socket.close());
  await page.goto("/settings");
  await expect(page).toHaveURL(`/match/${matchId}`);
  await page.getByRole("link", { name: "Back to lobby" }).click();
  await expect(page.getByText("Waiting for your previous debate to end…", { exact: true })).toBeVisible();
  await expect(page).toHaveURL("/");

  ended = true;
  await expect(page.getByRole("button", { name: "Find match", exact: true })).toBeEnabled();
});
