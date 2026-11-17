import { test, expect } from "@playwright/test";
import { account, cleanupAccounts, failedModelId, modelId, selectModel } from "./helpers";

test.afterEach(cleanupAccounts);

const topic = "Should cities make public transit free for everyone, including visitors and commuters?";
const twist = "Make your argument without using the word very, and explain one concrete example.";
const challenge = {
  day: "2026-11-16",
  topic: { topic, pro_position: "Transit should be free.", con_position: "Transit should not be free." },
  twist: { title: "Very banned", description: twist, max_chars: null },
  reward_points: 50, completed: false, resets_at: "2026-11-17T00:00:00Z",
};

test("homepage focuses on play and shows the full challenge with one navigation entry per destination", async ({ page, context }) => {
  await account(context);
  await page.route("**/v1/challenge/today", route => route.fulfill({ json: challenge }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Find a debate", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Play", exact: true })).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Leaderboards", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "How to play", exact: true })).toHaveCount(1);
  await expect(page.getByText(topic, { exact: true })).toBeVisible();
  await expect(page.getByText(twist, { exact: true })).toBeVisible();
  await expect(page.getByText(topic, { exact: true })).not.toHaveCSS("white-space", "nowrap");
  await expect(page.getByText(twist, { exact: true })).not.toHaveCSS("white-space", "nowrap");
  await expect(page.getByRole("link", { name: /history/i })).toBeVisible();
});

test("model picker supports keyboard selection, dismissal and remembered selection", async ({ page, context }) => {
  await account(context);
  await page.goto("/");
  await selectModel(page, modelId);
  const picker = page.getByRole("combobox", { name: "AI model", exact: true });
  await picker.focus();
  await picker.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await picker.press("End");
  await picker.press("Home");
  await picker.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(picker).toBeFocused();
  await expect(picker).toHaveAttribute("data-value", modelId);
  await picker.click();
  await page.getByRole("heading", { name: "Find a debate", exact: true }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await selectModel(page, failedModelId);
  await page.reload();
  await expect(picker).toHaveAttribute("data-value", failedModelId);
  await picker.click();
  await expect(picker).toHaveAttribute("aria-expanded", "true");
  const selected = page.getByRole("option").and(page.locator(`[data-value="${failedModelId}"]`));
  await expect(selected).toHaveAttribute("aria-selected", "true");
  await picker.press("Home");
  const firstOptionId = await page.getByRole("option").and(page.locator('[data-value="quick"]')).getAttribute("id");
  await expect(picker).toHaveAttribute("aria-activedescendant", firstOptionId!);
  await picker.press("Enter");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(picker).toHaveAttribute("data-value", "quick");
});

test("daily challenge only offers explicit cloud models", async ({ page, context }) => {
  await account(context);
  await page.goto("/challenge");
  const picker = page.getByRole("combobox", { name: "AI model", exact: true });
  await expect(picker).toHaveAttribute("aria-disabled", "false");
  await picker.click();
  await expect(page.getByRole("option").and(page.locator(`[data-value="${modelId}"]`))).toBeVisible();
  await expect(page.getByRole("option").filter({ hasText: /Quick Queue|Bring your own model/i })).toHaveCount(0);
});

test("homepage challenge failure can retry without blocking matchmaking", async ({ page, context }) => {
  await account(context);
  let failed = true;
  await page.route("**/v1/challenge/today", route => route.fulfill(failed
    ? { status: 500, json: { detail: "unavailable" } }
    : { json: challenge }));
  await page.goto("/");
  const section = page.getByRole("region", { name: "Daily challenge", exact: true });
  await expect(section.getByRole("button", { name: "Retry challenge", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Find match", exact: true })).toHaveAttribute("aria-disabled", "false");
  failed = false;
  await section.getByRole("button", { name: "Retry challenge", exact: true }).click();
  await expect(section.getByText(topic, { exact: true })).toBeVisible();
});

test("Quick Queue sends an automatic model choice and Settings remains in the account menu", async ({ page, context }) => {
  const me = await account(context);
  let queued = false;
  await page.route("**/v1/match/status", route => route.fulfill({ json: { status: queued ? "queued" : "none" } }));
  await page.route("**/v1/match/queue", route => {
    queued = true;
    return route.fulfill({ json: { status: "queued" } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: me.tag, exact: true }).press("Enter");
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
  await page.getByRole("heading", { name: "Find a debate", exact: true }).click();
  await selectModel(page, "quick");
  const registration = page.waitForRequest(request => request.url().endsWith("/v1/match/queue") && request.method() === "POST");
  await page.getByRole("button", { name: "Find match", exact: true }).click();
  expect((await registration).postDataJSON()).toEqual({ model_id: null });
  await expect(page.getByRole("button", { name: "Cancel queue", exact: true })).toBeVisible();
});

test("BYOM shows setup instead of allowing an unready device into a match and remembers the source", async ({ page, context }) => {
  await account(context);
  await page.goto("/");
  const ownModel = page.getByRole("button", { name: "Bring your own model", exact: true });
  await expect(ownModel).toHaveAttribute("aria-disabled", "false");
  await ownModel.click();
  await expect(ownModel).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("combobox", { name: "AI model", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Connect a device", exact: true })).toHaveAttribute("href", "/bilc");
  await expect(page.getByRole("button", { name: "Find match", exact: true })).toHaveAttribute("aria-disabled", "true");
  await page.reload();
  await expect(ownModel).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("link", { name: "Connect a device", exact: true })).toBeVisible();
  await selectModel(page, modelId);
  await expect(page.getByRole("combobox", { name: "AI model", exact: true })).toHaveAttribute("data-value", modelId);
  await expect(page.getByRole("button", { name: "Find match", exact: true })).toHaveAttribute("aria-disabled", "false");
});

test("local logos load for routed and first-party models with a neutral unknown-author fallback", async ({ page, context }) => {
  await account(context);
  await page.route("**/v1/arenas", route => route.fulfill({ json: [
    { id: modelId, display_name: "OpenAI: GPT example", kind: "provided", provider_slug: "openrouter", model_slug: "openai/gpt-example" },
    { id: failedModelId, display_name: "Claude example", kind: "provided", provider_slug: "anthropic", model_slug: "claude-example" },
    { id: "33333333-3333-4333-8333-333333333333", display_name: "Unknown model", kind: "provided", provider_slug: "openrouter", model_slug: "unknown/model" },
  ] }));
  await page.goto("/");
  const picker = page.getByRole("combobox", { name: "AI model", exact: true });
  await expect(picker).toHaveAttribute("aria-disabled", "false");
  await picker.click();
  const routed = page.getByRole("option", { name: "OpenAI: GPT example", exact: true });
  await expect(routed).not.toContainText("via OpenRouter");
  const direct = page.getByRole("option", { name: "Claude example", exact: true });
  await expect(routed.locator("img")).toHaveAttribute("src", "/model-logos/openai.svg");
  await expect(direct.locator("img")).toHaveAttribute("src", "/model-logos/anthropic.svg");
  await expect.poll(() => routed.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect.poll(() => direct.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByRole("option", { name: "Unknown model", exact: true }).locator("img")).toHaveCount(0);
  await direct.click();
  await expect(picker.locator("img")).toHaveAttribute("src", "/model-logos/anthropic.svg");
});
