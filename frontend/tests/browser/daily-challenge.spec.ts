import { expect, test } from "@playwright/test";
import { account, cleanupAccounts } from "./helpers";

const day = {
  day: "2026-11-18",
  topic: { topic: "Should transit be free?", pro_position: "Yes", con_position: "No" },
  twist: { title: "Be concrete", description: "Use one example.", max_chars: null },
  reward_points: 50,
  completed: true,
  resets_at: "2026-11-19T00:00:00Z",
};

test.afterEach(cleanupAccounts);

test("an open challenge switches to the next topic and clears completion at midnight UTC", async ({ page, context }) => {
  await account(context);
  await page.clock.install({ time: new Date("2026-11-18T23:59:46Z") });
  let response = day;
  await page.route("**/v1/challenge/today", route => route.fulfill({ json: response }));
  const queueStatus = page.waitForResponse(response => response.url().endsWith("/v1/match/status") && response.ok());
  await page.goto("/challenge");
  await expect(page.getByRole("heading", { name: "Completed today" })).toBeVisible();
  // Let the queue read finish before advancing past its request timeout.
  await (await queueStatus).finished();

  response = {
    ...day,
    day: "2026-11-19",
    topic: { ...day.topic, topic: "Should trains run all night?" },
    completed: false,
    resets_at: "2026-11-20T00:00:00Z",
  };
  await page.clock.fastForward(15_000);

  await expect(page.getByRole("heading", { name: "Should trains run all night?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Completed today" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Find match" })).toBeEnabled();
});

test("an unavailable topic has a retry and no matchmaking action", async ({ page, context }) => {
  await account(context);
  await page.clock.setFixedTime(new Date("2026-11-18T12:00:00Z"));
  let response: Omit<typeof day, "topic"> & { topic: typeof day.topic | null } = { ...day, completed: false, topic: null };
  await page.route("**/v1/challenge/today", route => route.fulfill({ json: response }));
  await page.goto("/challenge");
  await expect(page.getByText("No topic available today")).toBeVisible();
  await expect(page.getByRole("button", { name: "Find match" })).toHaveCount(0);

  response = { ...response, topic: day.topic };
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByRole("heading", { name: day.topic.topic })).toBeVisible();
  await expect(page.getByRole("button", { name: "Find match" })).toBeEnabled();
});
