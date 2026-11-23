import { test, expect } from "@playwright/test";
import { cleanupAccounts, account, accountTag, backend, chooseSide, failedModelId, join, password, submit, selectModel, verdictScores } from "./helpers";

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
    let releaseJoin: (() => void) | undefined;
    await other.routeWebSocket("**/v1/game/**", browserSocket => {
      const server = browserSocket.connectToServer();
      browserSocket.onMessage(message => {
        if (JSON.parse(String(message)).type === "JOIN") releaseJoin = () => server.send(message);
        else server.send(message);
      });
    });
    await join(page);
    await join(other);
    await expect.poll(() => releaseJoin !== undefined).toBe(true);
    await expect(page.getByRole("status").filter({ hasText: "Waiting for both players" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Should transit be free?" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Pro /i })).toHaveCount(0);
    releaseJoin!();
    await Promise.all([page, other].map(async player => {
      await expect(player.getByRole("heading", { name: "Should transit be free?" })).toBeVisible();
      await expect(player.getByRole("button", { name: /^Con /i })).toBeVisible();
    }));
    await chooseSide(page, "Con");
    await Promise.all([
      expect(page.getByRole("heading", { name: "Your side · Con", level: 1 })).toHaveAccessibleDescription("Transit should not be free."),
      expect(other.getByRole("heading", { name: "Your side · Pro", level: 1 })).toHaveAccessibleDescription("Transit should be free."),
    ]);
    await expect(page.getByRole("heading", { name: "Your side · Con", level: 2 })).toBeVisible();
    await expect(other.getByRole("heading", { name: "Your side · Pro", level: 2 })).toBeVisible();
    await Promise.all([submit(page, "PRIVATE-FIRST"), submit(other, "PRIVATE-SECOND")]);
    await expect(page.getByRole("heading", { name: /why the judge/i })).toBeVisible();
    await expect(other.getByRole("heading", { name: /why the judge/i })).toBeVisible();
    const scorecard = (player: typeof page) => player.getByRole("region", { name: "Judge’s scorecard" });
    for (const player of [page, other]) {
      await expect(scorecard(player)).toContainText(/16\s*\/\s*20/);
      await expect(scorecard(player)).toContainText(/10\s*\/\s*20/);
      const argumentQuality = scorecard(player).getByRole("row").filter({
        has: player.getByRole("rowheader", { name: /^Argument quality/ }),
      });
      await expect(argumentQuality.getByRole("cell")).toHaveText(["4/5", "2/5"]);
    }
    expect(await page.evaluate(() => "modelExecuted" in window)).toBe(false);
    expect(await other.evaluate(() => "modelExecuted" in window)).toBe(false);
    await expect(page.getByText('<img src=x onerror="window.modelExecuted=true"> Literal argument.', { exact: true })).toBeVisible();
    const history = await (await context.request.get(`${backend}/v1/users/${me.id}/matches`)).json();
    expect(history.items).toHaveLength(1);
    const detail = await (await context.request.get(`${backend}/v1/matches/${history.items[0].id}`)).json();
    expect(detail.scorecard).toEqual(verdictScores);
    expect(JSON.stringify(detail)).not.toMatch(/PRIVATE-FIRST|PRIVATE-SECOND/);
    const stats = await (await context.request.get(`${backend}/v1/users/me/arena-stats`)).json();
    expect(stats.debates_played).toBe(1);
    const ladder = await (await context.request.get(`${backend}/v1/ladders`)).json();
    expect(ladder).toBeTruthy();
    await page.goto("/matches");
    await expect(page.getByText("Should transit be free?", { exact: true })).toBeVisible();
    await page.goto(`/matches/${history.items[0].id}`);
    await expect(scorecard(page)).toContainText(/16\s*\/\s*20/);
    await expect(scorecard(page)).toContainText(/10\s*\/\s*20/);
    await expect(page.getByText(detail.verdict_reasoning, { exact: true })).toBeVisible();
    const profile = await context.newPage();
    await profile.goto(`/profile/${me.tag}`);
    const averages = profile.getByRole("region", { name: "Average judge scores" });
    await expect(averages).toContainText(/10(?:\.0)?\s*\/\s*20/);
    await expect(averages).toContainText("From 1 scored debate");
    await expect(averages).toContainText("Argument quality");
    await profile.close();
    // Load the rankings independently while keeping the history page open.
    const leaderboard = await context.newPage();
    await leaderboard.goto("/leaderboards");
    await expect(leaderboard.getByRole("main").getByText(me.tag, { exact: true })).toBeVisible();
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

test("side selection times out, and a failed cloud model then voids the match", async ({ browser, page, context }) => {
  test.setTimeout(45000);
  await account(context);
  const otherContext = await browser.newContext();
  try {
    await account(otherContext);
    const other = await otherContext.newPage();
    await join(page, failedModelId);
    await join(other, failedModelId);
    await Promise.all([page, other].map(async player => {
      await expect(player.getByRole("button", { name: /^Pro /i })).toBeVisible();
      await expect(player.locator("textarea")).toBeVisible({ timeout: 25_000 });
    }));
    const sides = await Promise.all([page, other].map(player => player.getByText(/^Your side · (Pro|Con)$/).textContent()));
    expect(sides.sort()).toEqual(["Your side · Con", "Your side · Pro"]);
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
    await chooseSide(page, "Pro");
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
