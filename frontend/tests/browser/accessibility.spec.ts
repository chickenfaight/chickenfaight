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
