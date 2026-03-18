import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["e2e/**/*"],
    coverage: {
      reporter: ["text", "json-summary"],
      exclude: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "playwright.config.ts",
        "src/server/auth.ts",
        "src/pages/index.tsx",
        "src/scripts/**",
      ],
    },
  },
});
