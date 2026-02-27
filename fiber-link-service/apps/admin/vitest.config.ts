import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      reporter: ["text", "json-summary"],
      exclude: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "src/server/auth.ts",
        "src/pages/index.tsx",
        "src/pages/dashboard-model.ts",
        "src/server/api/routers/withdrawal-policy.ts",
      ],
    },
  },
});
