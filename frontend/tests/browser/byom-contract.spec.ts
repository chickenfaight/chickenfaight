import { test, expect } from "@playwright/test";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as pathJoin, resolve } from "node:path";
import { cleanupAccounts, account, backend, join, submit } from "./helpers";

test.afterEach(cleanupAccounts);

test("real Go clients play through the Python backend and return idle", async ({ browser, page, context }) => {
  test.setTimeout(90000);
  const dir = await mkdtemp(pathJoin(tmpdir(), "bilc-contract-"));
  const executable = pathJoin(dir, "contract");
  await promisify(execFile)("go", ["build", "-o", executable, "./tests/contract"], { cwd: resolve("../bilc"), timeout: 60000 });
  const local = createServer((request, response) => {
    request.resume();
    if (request.url === "/api/generate") { response.end("{}"); return; }
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end('data: {"choices":[{"delta":{"content":"Local contract argument"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>(r => local.listen(0, "127.0.0.1", r));
  const address = local.address();
  if (!address || typeof address === "string") throw new Error("No fake model address");
  const modelUrl = `http://127.0.0.1:${address.port}/v1`;
  const children: ChildProcess[] = [];
  const otherContext = await browser.newContext();
  try {
    await account(context);
    await account(otherContext);
    for (const browserContext of [context, otherContext]) {
      const code = (await (await browserContext.request.post(`${backend}/v1/bilc/pairing-codes`)).json()).code;
      const child = spawn(executable, [backend, code, modelUrl], { stdio: ["ignore", "ignore", "pipe"] });
      children.push(child);
      await expect.poll(async () => {
        const devices = await (await browserContext.request.get(`${backend}/v1/bilc/devices`)).json();
        return devices[0]?.status;
      }, { timeout: 10000 }).toBe("idle");
    }
    const arenas = await (await context.request.get(`${backend}/v1/arenas`)).json();
    const byom = arenas.find((arena: { kind: string }) => arena.kind === "byom").id;
    const other = await otherContext.newPage();
    await join(page, byom);
    await join(other, byom);
    await Promise.all([submit(page), submit(other)]);
    await expect(page.getByRole("heading", { name: /why the judge/i })).toBeVisible();
    await expect(other.getByRole("heading", { name: /why the judge/i })).toBeVisible();
    await expect(page.getByText("Local contract argument", { exact: true })).toBeVisible();
    for (const browserContext of [context, otherContext]) {
      await expect.poll(async () => (await (await browserContext.request.get(`${backend}/v1/bilc/devices`)).json())[0]?.status).toBe("idle");
    }
  } finally {
    for (const child of children) {
      const exited = new Promise<void>(r => { if (child.exitCode !== null) r(); else child.once("exit", () => r()); });
      child.kill("SIGTERM");
      const killTimer = setTimeout(() => child.kill("SIGKILL"), 3000);
      await exited;
      clearTimeout(killTimer);
    }
    await otherContext.close();
    await new Promise<void>(r => local.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});
