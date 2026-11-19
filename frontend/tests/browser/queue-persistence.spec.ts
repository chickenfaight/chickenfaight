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
  const status = indicator.locator(":scope > div");
  const timer = indicator.getByRole("timer", { name: "Time in queue" });
  await expect(status.getByText("Test model", { exact: true })).toBeVisible();
  await expect(page.getByRole("timer", { name: "Time in queue" })).toHaveCount(1);
  await expect.poll(async () => elapsed(await timer.innerText())).toBeGreaterThan(beforeNavigation);
  const beforeReload = elapsed(await timer.innerText());

  await page.reload();
  await expect.poll(async () => elapsed(await timer.innerText())).toBeGreaterThanOrEqual(beforeReload);
  const cancel = indicator.getByRole("button", { name: "Cancel queue", exact: true });
  await expect(cancel).toBeVisible();
  const [statusBounds, cancelBounds] = await Promise.all([status.boundingBox(), cancel.boundingBox()]);
  expect(cancelBounds!.x).toBeGreaterThanOrEqual(statusBounds!.x + statusBounds!.width);
  await cancel.click();
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
  await page.emulateMedia({ reducedMotion: "no-preference" });
  let fail = false;
  let cancelled = false;
  const arena = "Nemotron 3.5 Super VL: Extended context edition";
  const queued = { status: "queued", queue: {
    mode: "daily", model_id: modelId, model_display_name: `NVIDIA: ${arena}`,
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
  const active = indicator.locator(":scope > div");
  const cancel = indicator.getByRole("button", { name: "Cancel queue", exact: true });
  const model = active.getByText(arena, { exact: true });
  await expect(model).toBeVisible();
  await expect(model).toHaveCSS("text-overflow", "ellipsis");
  expect(await model.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await expect.poll(async () => elapsed(await indicator.getByRole("timer").innerText())).toBeGreaterThanOrEqual(45);
  await expect(active).toBeInViewport({ ratio: 1 });
  await expect(cancel).toBeInViewport({ ratio: 1 });
  const ring = active.locator('[class*="animate-spin"]');
  await expect(ring).toHaveCSS("animation-name", "spin");
  await expect(ring).toHaveCSS("width", "28px");
  await expect(ring).toHaveCSS("border-top-width", "3px");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(ring).toHaveCSS("animation-name", "none");
  const background = await active.evaluate(element => getComputedStyle(element).backgroundColor);
  await model.click();
  await expect(active).toHaveCSS("background-color", background);
  await expect(indicator.getByRole("button")).toHaveCount(1);
  await expect(indicator.locator(":popover-open")).toHaveCount(0);
  await expect(header.getByRole("button", { name: "Search players" })).toBeInViewport({ ratio: 1 });
  const contentTop = await page.locator("#main-content").evaluate(element => element.getBoundingClientRect().top + scrollY);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

  fail = true;
  await expect(indicator.getByText("Queue issue", { exact: true })).toBeVisible();
  const retry = indicator.getByRole("button", { name: "Retry queue status" });
  await expect(retry).toBeVisible();
  fail = false;
  await retry.press("Enter");
  await expect(model).toBeVisible();
  await cancel.click();
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
