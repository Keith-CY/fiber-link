import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/.next/**"],
    coverage: {
      reporter: ["text", "json-summary"],
      exclude: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "src/server/auth.ts",
        // Presentational / client-data layer is exercised by the Playwright
        // acceptance harness, not vitest unit tests.
        "src/pages/**",
        "src/components/**",
        "src/utils/trpc.ts",
        "src/lib/format.ts",
      ],
    },
  },
});
