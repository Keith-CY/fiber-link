import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      reporter: ["text", "json-summary"],
      include: [
        "src/contracts.ts",
        "src/nonce-store.ts",
        "src/rate-limit.ts",
        "src/rpc-error.ts",
        "src/secret-map.ts",
        "src/auth/hmac.ts",
      ],
      exclude: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "src/entry.ts",
        "src/server.ts",
        "src/scripts/**",
        "src/rpc.ts",
        "src/methods/**",
        "src/repositories/**",
        "src/fastify.d.ts",
      ],
    },
  },
});
