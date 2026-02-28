import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      reporter: ["text", "json-summary"],
      exclude: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "src/entry.ts",
        "src/server.ts",
        "src/scripts/**",
        "src/rpc.ts",
        "src/fastify.d.ts",
      ],
    },
  },
});
