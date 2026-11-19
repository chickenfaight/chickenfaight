import { expect, test } from "@playwright/test";
import { account, cleanupAccounts } from "./helpers";

test.afterEach(cleanupAccounts);

test("mobile navigation has visible labels and focuses the destination", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await account(context);
  await page.goto("/");
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  const sections = page.getByRole("navigation", { name: "Sections" });
  await expect(menu).toBeVisible();
  await expect(sections).toBeHidden();
  await menu.press("Enter");
  await expect(sections.getByRole("link", { name: "Daily challenge" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sections).toBeHidden();
  await expect(menu).toBeFocused();

  await menu.press("Enter");
  await sections.getByRole("link", { name: "Daily challenge" }).press("Enter");
  await expect(page).toHaveURL("/challenge");
  await expect(sections).toBeHidden();
  await expect(page.locator("#main-content")).toBeFocused();

  await menu.press("Enter");
  await expect(sections.getByRole("link", { name: "Daily challenge" })).toHaveAttribute("aria-current", "page");
  await sections.getByRole("link", { name: "Settings" }).press("Enter");
  await expect(page).toHaveURL("/settings");
  await expect(sections).toBeHidden();
  await expect(page.locator("#main-content")).toBeFocused();

  await page.setViewportSize({ width: 320, height: 740 });
  await menu.press("Enter");
  await expect(sections.getByRole("link", { name: "Play", exact: true })).toBeInViewport({ ratio: 1 });
});

test("player search opens and submits from a 320 px header", async ({ page, context }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const me = await account(context);
  await page.goto("/");
  const search = page.getByRole("button", { name: "Search players", exact: true });
  const input = page.getByRole("combobox", { name: "Search players by username or tag", exact: true });
  await expect(search).toBeVisible();
  await search.click();
  await expect(input).toBeFocused();
  await expect(input).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await input.press("Escape");
  await expect(input).toBeHidden();
  await expect(search).toBeFocused();

  await search.click();
  await page.getByRole("button", { name: "Close player search", exact: true }).click();
  await expect(input).toBeHidden();
  await expect(search).toBeFocused();

  await search.click();
  await input.fill(me.tag);
  await page.getByRole("link", { name: "See all results", exact: true }).click();
  await expect(page).toHaveURL(`/search?q=${me.tag}`);
  await expect(page.getByRole("heading", { name: `Results for “${me.tag}”` })).toBeVisible();
  await expect(page.locator("#main-content")).toBeFocused();
});
