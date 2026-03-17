import { defineConfig } from "@playwright/test";

const artifactRoot = process.env.ADMIN_E2E_ARTIFACT_ROOT ?? ".artifacts/admin-controls-e2e";
const port = Number(process.env.ADMIN_E2E_PORT ?? "4318");
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: `${artifactRoot}/playwright-report`, open: "never" }],
  ],
  outputDir: `${artifactRoot}/test-results`,
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1600, height: 1200 },
  },
  webServer: {
    command: `bun run src/scripts/admin-console-server.ts --fixture=./e2e/fixtures/admin-controls.json --port=${port}`,
    url: `${baseURL}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
