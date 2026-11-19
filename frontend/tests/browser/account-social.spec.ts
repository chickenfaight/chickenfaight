import { test, expect } from "@playwright/test";
import { account, backend, cleanupAccounts } from "./helpers";

test.afterEach(cleanupAccounts);

test("avatar validation, upload, reload and removal use the real API", async ({ page, context }) => {
  await account(context);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Edit profile picture", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Change picture", exact: true });
  await dialog.locator("input[type=file]").setInputFiles({ name: "bad.txt", mimeType: "text/plain", buffer: Buffer.from("not an image") });
  await expect(dialog.getByRole("alert")).toContainText("Use a PNG, JPEG, or WebP image");
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 4;
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await dialog.locator("input[type=file]").setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === "/settings" && response.request().method() === "GET");
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await (await refreshed).finished();
  await page.reload();
  const me = await (await context.request.get(`${backend}/auth/me`)).json();
  expect(me.avatar_url).toMatch(/\/avatar\?v=/);
  const stored = await context.request.get(`${backend}${me.avatar_url}`);
  expect(stored.status()).toBe(200);
  expect(stored.headers()["content-type"]).toBe("image/webp");
  await page.getByRole("button", { name: "Edit profile picture", exact: true }).click();
  await dialog.getByRole("button", { name: "Remove picture", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect((await (await context.request.get(`${backend}/auth/me`)).json()).avatar_url).toBeNull();
});

test("friend request, acceptance and blocking update both players", async ({ browser, page, context }) => {
  const first = await account(context);
  const otherContext = await browser.newContext();
  try {
    const second = await account(otherContext);
    const other = await otherContext.newPage();
    await page.goto(`/profile/${second.tag}`);
    await page.getByRole("button", { name: "Add friend", exact: true }).click();
    const cancel = page.getByRole("button", { name: "Cancel request", exact: true });
    const block = page.getByRole("button", { name: "Block", exact: true });
    await expect(cancel).toBeVisible();
    await expect(page.getByText("Friend request sent.", { exact: true })).toBeVisible();
    await expect.poll(async () => {
      const [cancelBox, blockBox] = await Promise.all([cancel.boundingBox(), block.boundingBox()]);
      return cancelBox && blockBox ? Math.abs(cancelBox.y - blockBox.y) : Infinity;
    }).toBeLessThan(1);
    await other.goto(`/profile/${first.tag}`);
    await other.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(other.getByRole("button", { name: "Remove friend", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Remove friend", exact: true })).toBeVisible();
    await block.click();
    await expect(page.getByRole("button", { name: "Unblock", exact: true })).toBeVisible();
    // The block label updates locally before the refreshed profile removes the
    // friendship controls. Wait for that layout change before the next click.
    await expect(page.getByRole("button", { name: "Remove friend", exact: true })).not.toBeVisible();
    const blocked = await (await otherContext.request.get(`${backend}/v1/users/by-tag/${first.tag}`)).json();
    expect(blocked.read_blocked).toBe(true);
    expect((await (await context.request.get(`${backend}/v1/friends`)).json()).items).toHaveLength(0);
    await page.getByRole("button", { name: "Unblock", exact: true }).click();
    await expect(page.getByRole("button", { name: "Add friend", exact: true })).toBeVisible();
    expect((await (await otherContext.request.get(`${backend}/v1/users/by-tag/${first.tag}`)).json()).read_blocked).toBe(false);
  } finally { await otherContext.close(); }
});
