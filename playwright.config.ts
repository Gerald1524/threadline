import fs from "node:fs";
import { defineConfig } from "@playwright/test";

for (const f of [".env.local", ".env"]) if (fs.existsSync(f)) process.loadEnvFile(f);

/**
 * End-to-end tests run against a production build with a freshly seeded database:
 * E2E_DATABASE_URL (PostgreSQL) when set, otherwise an embedded database under .data/e2e.
 */
const PORT = 3200;
const dbEnv: Record<string, string> = process.env.E2E_DATABASE_URL ? { DATABASE_URL: process.env.E2E_DATABASE_URL } : { DATABASE_URL: "", THREADLINE_DATA_DIR: ".data/e2e" };

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1360, height: 900 },
    trace: "off",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: `tsx scripts/seed.ts --reset && next build && next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: { ...dbEnv, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", THREADLINE_DEMO_LOGIN: "1", THREADLINE_INSECURE_COOKIES: "1", SESSION_SECRET: "e2e-only-secret-e2e-only-secret-e2e-only", THREADLINE_ENCRYPTION_KEY: "e2e-only-encryption-key-e2e-only-encryption-key" },
  },
});
