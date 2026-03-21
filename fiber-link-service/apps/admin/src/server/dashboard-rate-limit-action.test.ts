import { describe, expect, it } from "vitest";
import { handleDashboardRateLimitAction } from "./dashboard-rate-limit-action";

describe("dashboard rate limit action", () => {
  it("returns a change set redirect for SUPER_ADMIN", async () => {
    const result = await handleDashboardRateLimitAction(
      {
        roleHeader: "SUPER_ADMIN",
        body: {
          enabled: "true",
          windowMs: "90000",
          maxRequests: "500",
        },
      },
      {
        createRateLimitChangeSet: async () => ({
          changedKeys: ["RPC_RATE_LIMIT_WINDOW_MS", "RPC_RATE_LIMIT_MAX_REQUESTS"],
          envSnippet: "RPC_RATE_LIMIT_WINDOW_MS=90000\nRPC_RATE_LIMIT_MAX_REQUESTS=500",
          rollbackSnippet: "RPC_RATE_LIMIT_WINDOW_MS=60000\nRPC_RATE_LIMIT_MAX_REQUESTS=300",
        }),
      },
    );

    expect(result.statusCode).toBe(303);
    expect(result.location).toContain("rateLimitChangedKey=RPC_RATE_LIMIT_WINDOW_MS");
    expect(result.location).toContain("rateLimitEnvSnippet=RPC_RATE_LIMIT_WINDOW_MS%3D90000");
  });

  it("rejects COMMUNITY_ADMIN from global rate limit management", async () => {
    const result = await handleDashboardRateLimitAction(
      {
        roleHeader: "COMMUNITY_ADMIN",
        body: {
          enabled: "true",
          windowMs: "90000",
          maxRequests: "500",
        },
      },
      {},
    );

    expect(result.statusCode).toBe(303);
    expect(result.location).toContain("rateLimitError=Only+SUPER_ADMIN+can+manage+global+rate+limiting");
  });
});
