import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      reporter: ["text", "json-summary"],
      exclude: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "drizzle.config.ts",
        "src/index.ts",
        "src/ledger-repo.ts",
        "src/tip-intent-repo.ts",
        "src/withdrawal-policy-repo.ts",
        "src/withdrawal-repo.ts",
      ],
    },
  },
});
