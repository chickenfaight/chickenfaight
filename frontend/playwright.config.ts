import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: [
    {
      command: "cd ../backend && APP_ENV=test FRONTEND_URL=http://127.0.0.1:3100 SECURE_COOKIES=false PYTHONPATH=.:tests .venv/bin/python tests/e2e_server.py",
      url: "http://127.0.0.1:8765/health", reuseExistingServer: false,
    },
    {
      command: "pnpm dev --hostname 127.0.0.1 --port 3100",
      url: "http://127.0.0.1:3100/health", reuseExistingServer: false,
      env: { NEXT_PUBLIC_BACKEND_URL: "http://127.0.0.1:8765" },
      timeout: 120000,
    },
  ],
});
