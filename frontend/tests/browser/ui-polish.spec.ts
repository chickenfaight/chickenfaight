import { test, expect } from "@playwright/test";
import { account, cleanupAccounts } from "./helpers";

test.afterEach(cleanupAccounts);

test("keyboard users can skip navigation and identify the current account section", async ({ page, context, browserName }) => {
  await account(context);
  await page.goto("/settings");
  const skip = page.getByRole("link", { name: "Skip to content", exact: true });
  // WebKit on macOS uses Option+Tab to include links in keyboard navigation.
  await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  await expect(skip).toBeFocused();
  await skip.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  await expect(page.getByRole("navigation").getByRole("link", { name: "Settings", exact: true })).toHaveAttribute("aria-current", "page");
});

test("coaching load errors retry and streamed replies stay outside live regions", async ({ page, context }) => {
  await account(context);
  let fail = true;
  await page.route("**/v1/tips", route => route.fulfill(fail ? { status: 503, json: {} } : { json: { tips: ["Use evidence."] } }));
  await page.route("**/v1/tips/chat", route => route.fulfill({ contentType: "text/plain", body: "<b>Use a concrete example.</b>" }));
  await page.goto("/tips");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Couldn’t load your coach and tips.");
  fail = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Your question", exact: true });
  await expect(input).toBeEditable();
  await input.fill("How do I make a claim convincing?");
  await input.press("Enter");
  const transcript = page.getByRole("region", { name: "Coaching conversation", exact: true });
  await expect(transcript.getByText("<b>Use a concrete example.</b>", { exact: true })).toBeVisible();
  expect(await transcript.evaluate(element => element.closest('[aria-live]:not([aria-live="off"]), [role="status"], [role="log"]') !== null)).toBe(false);
  await expect(transcript.locator("b")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Reply complete.");
});

test("an oversized follow-up remains editable without losing the conversation", async ({ page, context }) => {
  await account(context);
  let sent = 0;
  const reply = "Evidence ".repeat(200);
  await page.route("**/v1/tips/chat", route => {
    sent += 1;
    return route.fulfill({ contentType: "text/plain", body: reply });
  });
  await page.goto("/tips");
  const input = page.getByRole("textbox", { name: "Your question", exact: true });
  await expect(input).toBeEditable();
  for (let index = 0; index < 4; index += 1) {
    await input.fill("Why?");
    await input.press("Enter");
    await expect(page.getByRole("status")).toContainText("Reply complete.");
  }
  const remaining = 8000 - 4 * (reply.length + 4);
  await input.fill("x".repeat(remaining + 1));
  await expect(input).toBeEditable();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toHaveAttribute("aria-disabled", "true");
  await input.press("Enter");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Keep your question to");
  expect(sent).toBe(4);
  await input.fill("A shorter follow-up");
  await expect(page.getByRole("button", { name: "Send", exact: true })).toHaveAttribute("aria-disabled", "false");
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
});
