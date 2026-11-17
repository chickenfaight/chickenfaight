import { test, expect } from "@playwright/test";
import { cleanupAccounts, account, accountTag, backend, failedModelId, join, password, submit, selectModel } from "./helpers";

test.afterEach(cleanupAccounts);

test("signup, authenticated SSR, logout and login keep credentials out of URLs", async ({ page, context }) => {
  const tag = accountTag("signup");
  await page.goto("/signup");
  await expect(page.locator("form")).toHaveAttribute("method", "post");
  await page.getByLabel("Tag", { exact: true }).fill(tag);
  await page.getByLabel("Username", { exact: true }).fill(tag);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL("/");
  const profile = page.getByRole("button", { name: tag, exact: true });
  // A changed URL alone doesn't mean the lobby and its session have rendered.
  await expect(profile).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL("/");
  await expect(profile).toBeVisible();
  const cookie = (await context.cookies(backend)).find(c => c.name === "session");
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");
  // Let the app own the redirect. An API logout followed by goto races the
  // reloaded lobby's session check, which can also navigate to /login.
  // Keyboard activation avoids the menu's mouse-hover open/close timers.
  await profile.press("Enter");
  const loggedOut = page.waitForResponse(response => response.url() === `${backend}/auth/logout` && response.request().method() === "POST");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  expect((await loggedOut).status()).toBe(204);
  await expect(page).toHaveURL("/login");
  await expect(page.locator("form")).toHaveAttribute("method", "post");
  expect((await context.request.get(`${backend}/auth/me`)).status()).toBe(401);
  await page.getByLabel("Tag", { exact: true }).fill(tag);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("/");
  await expect(profile).toBeVisible();
  expect(page.url()).not.toContain(password);
});

test("two browsers complete a real match and immediately see saved results", async ({ browser, page, context }) => {
  const me = await account(context);
  const otherContext = await browser.newContext();
  try {
    const other = await otherContext.newPage();
    await account(otherContext);
    await join(page);
    await join(other);
    await Promise.all([submit(page, "PRIVATE-FIRST"), submit(other, "PRIVATE-SECOND")]);
    await expect(page.getByRole("heading", { name: /why the judge/i })).toBeVisible();
    await expect(other.getByRole("heading", { name: /why the judge/i })).toBeVisible();
    expect(await page.evaluate(() => "modelExecuted" in window)).toBe(false);
    expect(await other.evaluate(() => "modelExecuted" in window)).toBe(false);
    await expect(page.getByText('<img src=x onerror="window.modelExecuted=true"> Literal argument.', { exact: true })).toBeVisible();
    const history = await (await context.request.get(`${backend}/v1/users/${me.id}/matches`)).json();
    expect(history.items).toHaveLength(1);
    const detail = await (await context.request.get(`${backend}/v1/matches/${history.items[0].id}`)).json();
    expect(JSON.stringify(detail)).not.toMatch(/PRIVATE-FIRST|PRIVATE-SECOND/);
    const stats = await (await context.request.get(`${backend}/v1/users/me/arena-stats`)).json();
    expect(stats.debates_played).toBe(1);
    const ladder = await (await context.request.get(`${backend}/v1/ladders`)).json();
    expect(ladder).toBeTruthy();
    await page.goto("/matches");
    await expect(page.getByText("Should transit be free?", { exact: true })).toBeVisible();
    await page.goto("/leaderboards");
    await expect(page.getByRole("main").getByText(me.tag, { exact: true })).toBeVisible();
  } finally {
    await otherContext.close();
  }
});

test("queue cancellation and rejoin recover without duplicate registration", async ({ page, context }) => {
  await account(context);
  await join(page);
  await page.getByRole("button", { name: "Cancel queue", exact: true }).click();
  await expect(page.getByRole("button", { name: "Find match", exact: true })).toBeVisible();
  expect((await (await context.request.get(`${backend}/v1/match/status`)).json()).status).toBe("none");
  await page.getByRole("button", { name: "Find match", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cancel queue", exact: true })).toBeVisible();
  await context.request.delete(`${backend}/v1/match/queue`);
});

test("failed cloud model voids a match and awards no points", async ({ browser, page, context }) => {
  await account(context);
  const otherContext = await browser.newContext();
  try {
    await account(otherContext);
    const other = await otherContext.newPage();
    await join(page, failedModelId);
    await join(other, failedModelId);
    await Promise.all([expect(page.locator("textarea")).toBeVisible(), expect(other.locator("textarea")).toBeVisible()]);
    // Each side generates independently. One failed turn ends the match, so a
    // second click can race the result removing the opponent's prompt form.
    await page.locator("textarea").fill("Use evidence");
    await page.getByRole("button", { name: "Submit prompt", exact: true }).click();
    await expect(other.getByText(/debate model failed to respond/i)).toBeVisible();
    await expect(page.getByText(/debate model failed to respond/i)).toBeVisible();
    const stats = await (await context.request.get(`${backend}/v1/users/me/arena-stats`)).json();
    expect(stats.points).toBe(0);
  } finally { await otherContext.close(); }
});

test("a non-admin cannot upload topics", async ({ page, context }) => {
  await account(context);
  const response = await context.request.post(`${backend}/v1/admin/topics`, { data: { text: "Cities | Topic | P | C" } });
  expect(response.status()).toBe(403);
  await page.goto("/admin/topics");
  await expect(page.getByRole("button", { name: /upload/i })).toHaveCount(0);
});

test("daily challenge persists completion and prevents a second entry", async ({ browser, page, context }) => {
  await account(context);
  const otherContext = await browser.newContext();
  try {
    await account(otherContext);
    const other = await otherContext.newPage();
    for (const p of [page, other]) {
      await p.goto("/challenge");
      await selectModel(p);
      await p.getByRole("button", { name: "Find match", exact: true }).click();
    }
    // Valid for every rotating twist: short, includes chicken, avoids banned words.
    await Promise.all([submit(page, "Use a chicken analogy."), submit(other, "Use a chicken analogy.")]);
    await expect(page.getByRole("heading", { name: /why the judge/i })).toBeVisible();
    expect((await (await context.request.get(`${backend}/v1/challenge/today`)).json()).completed).toBe(true);
    const repeated = await context.request.post(`${backend}/v1/match/queue`, { data: { model_id: "11111111-1111-4111-8111-111111111111", daily: true } });
    expect(repeated.status()).toBe(409);
    expect((await repeated.json()).code).toBe("CHALLENGE_ALREADY_COMPLETED");
    await page.goto("/challenge");
    await expect(page.getByRole("button", { name: "Find match", exact: true })).toHaveCount(0);
  } finally { await otherContext.close(); }
});
