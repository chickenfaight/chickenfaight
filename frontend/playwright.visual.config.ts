import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: "**/visual.spec.ts",
  projects: [{ name: "chromium", use: { browserName: "chromium", viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" } }],
  expect: { toHaveScreenshot: { stylePath: "./tests/browser/visual.css", animations: "disabled", caret: "hide", maxDiffPixelRatio: 0.001 } },
});
