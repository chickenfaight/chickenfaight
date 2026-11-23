import { expect, request, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

export const backend = "http://127.0.0.1:8765";
export const modelId = "11111111-1111-4111-8111-111111111111";
export const failedModelId = "22222222-2222-4222-8222-222222222222";
export const byomId = "6f1c9a52-3d8e-4b7a-9e21-b10c0000b10c";
export const password = "browser-test-password";
export const verdictScores = {
  argument_quality: { pro: 4, con: 2 },
  support_for_claims: { pro: 5, con: 3 },
  weighing_and_persuasiveness: { pro: 3, con: 1 },
  clarity_and_structure: { pro: 4, con: 4 },
};
const ownedAccounts: APIRequestContext[] = [];

export async function cleanupAccounts() {
  for (const client of ownedAccounts.splice(0)) {
    try { await client.delete(`${backend}/v1/users/me`); }
    finally { await client.dispose(); }
  }
}

export function accountTag(prefix = "browser") {
  // Random hexadecimal can form prohibited words after leetspeak normalization.
  // Decimal UUID digits keep fixtures valid without weakening real signup checks.
  const suffix = BigInt(`0x${crypto.randomUUID().replaceAll("-", "")}`).toString().slice(0, 16);
  return `${prefix}_${suffix}`;
}

export async function account(context: BrowserContext) {
  const tag = accountTag();
  const response = await context.request.post(`${backend}/auth/signup`, { data: { tag, username: tag, password } });
  expect(response.status(), await response.text()).toBe(204);
  // Keep a test-owned cleanup client even if a secondary browser closes on failure.
  ownedAccounts.push(await request.newContext({ storageState: await context.storageState() }));
  return { ...(await (await context.request.get(`${backend}/auth/me`)).json()), tag };
}

export async function selectModel(page: Page, model = modelId) {
  if (model === byomId) {
    const source = page.getByRole("button", { name: "Bring your own model", exact: true });
    await expect(source).toHaveAttribute("aria-disabled", "false");
    await source.click();
    await expect(source).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Your device is ready.", { exact: true })).toBeVisible();
    return;
  }
  const provided = page.getByRole("button", { name: "Provided models", exact: true });
  if (await provided.count()) {
    await expect(provided).toHaveAttribute("aria-disabled", "false");
    if (await provided.getAttribute("aria-pressed") !== "true") await provided.click();
  }
  const selection = page.getByRole("combobox", { name: "AI model", exact: true });
  await expect(selection).toHaveAttribute("aria-disabled", "false");
  await selection.click();
  await page.getByRole("option").and(page.locator(`[data-value="${model}"]`)).click();
  await expect(selection).toHaveAttribute("data-value", model);
}

export async function join(page: Page, model = modelId) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Find match", exact: true })).toBeVisible();
  await selectModel(page, model);
  await expect(page.getByRole("button", { name: "Find match", exact: true })).toHaveAttribute("aria-disabled", "false");
  const registration = page.waitForRequest(request => request.url().endsWith("/v1/match/queue") && request.method() === "POST");
  await page.getByRole("button", { name: "Find match", exact: true }).click();
  expect((await registration).postDataJSON().model_id).toBe(model);
}

export async function submit(page: Page, prompt = "Use concrete evidence.") {
  await expect(page).toHaveURL(/\/match\//);
  await page.locator("textarea").fill(prompt);
  await page.getByRole("button", { name: /submit/i }).click();
}

export async function chooseSide(page: Page, side: "Pro" | "Con") {
  await page.getByRole("button", { name: new RegExp(`^${side} `, "i") }).click();
}
