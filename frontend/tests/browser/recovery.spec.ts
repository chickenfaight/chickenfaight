import { test, expect } from "@playwright/test";
import { cleanupAccounts, account, backend, modelId, selectModel } from "./helpers";

test.afterEach(cleanupAccounts);

test("queue 409 recovers status and cancelling works", async ({ page, context }) => {
  await account(context);
  let attempted = false;
  await page.route("**/v1/match/status", route => route.fulfill({ json: { status: attempted ? "queued" : "none" } }));
  await page.route("**/v1/match/queue", route => {
    if (route.request().method() === "DELETE") return route.fulfill({ status: 204 });
    attempted = true;
    return route.fulfill({ status: 409, json: { code: "ALREADY_QUEUED", detail: "Already queued" } });
  });
  await page.goto("/");
  await selectModel(page, modelId);
  await page.getByRole("button", { name: "Find match", exact: true }).click();
  await page.getByRole("button", { name: "Cancel queue", exact: true }).click();
  await expect(page.getByRole("button", { name: "Find match", exact: true })).toBeVisible();
});

test("unavailable arena refreshes selection without claiming a queue entry", async ({ page, context }) => {
  await account(context);
  await page.route("**/v1/match/queue", route => route.fulfill({ status: 404, json: { code: "NOT_FOUND", detail: "Unavailable" } }));
  await page.goto("/");
  await selectModel(page, modelId);
  await page.getByRole("button", { name: "Find match", exact: true }).click();
  await expect(page.locator("p[role=alert]")).toContainText("arena is no longer available");
  await expect(page.getByRole("button", { name: "Cancel queue", exact: true })).toHaveCount(0);
});

test("match history can retry an error into the empty state", async ({ page, context }) => {
  const me = await account(context);
  let fail = true;
  await page.route(`**/v1/users/${me.id}/matches?*`, route => route.fulfill(fail
    ? { status: 500, json: { detail: "unavailable" } }
    : { json: { items: [], next_offset: null } }));
  await page.goto("/matches");
  await expect(page.getByText("Couldn’t load your debates.", { exact: false })).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByText("No debates yet.", { exact: false })).toBeVisible();
});

test("expired session redirects protected pages to login", async ({ page, context }) => {
  await account(context);
  await page.route("**/auth/me", route => route.fulfill({ status: 401, json: { detail: "expired" } }));
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login$/);
});

test("account edits persist through reload", async ({ page, context }) => {
  const hydrationErrors: string[] = [];
  page.on("console", message => {
    if (message.type() === "error" && /hydrated|hydration/i.test(message.text())) hydrationErrors.push(message.text());
  });
  await account(context);
  await page.goto("/settings");
  const deleteAccount = page.getByRole("button", { name: "Delete account…", exact: true });
  await expect(deleteAccount).toBeEnabled();
  await page.getByRole("button", { name: /edit username/i }).click();
  await page.getByRole("textbox", { name: "Username", exact: true }).fill("Updated player");
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === "/settings" && response.request().method() === "GET");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Change username", exact: true })).not.toBeVisible();
  await (await refreshed).finished();
  await page.reload();
  expect((await (await context.request.get(`${backend}/auth/me`)).json()).username).toBe("Updated player");
  await expect(page.getByText("Updated player", { exact: true }).first()).toBeVisible();
  await expect(deleteAccount).toBeEnabled();
  await deleteAccount.click();
  await expect(page.getByRole("dialog", { name: "Are you sure?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep my account", exact: true }).click();
  expect(hydrationErrors).toEqual([]);
});

test("failed queue request retries status before attempting another registration", async ({ page, context }) => {
  await account(context);
  let posts = 0;
  await page.route("**/v1/match/status", route => route.fulfill({ json: { status: posts ? "queued" : "none" } }));
  await page.route("**/v1/match/queue", route => {
    posts++;
    return route.abort("failed");
  });
  await page.goto("/");
  await selectModel(page, modelId);
  await page.getByRole("button", { name: "Find match", exact: true }).click();
  await page.getByRole("button", { name: "Retry queue status", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cancel queue", exact: true })).toBeVisible();
  expect(posts).toBe(1);
});
