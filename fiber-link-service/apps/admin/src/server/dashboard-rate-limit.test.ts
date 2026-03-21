import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildDashboardRateLimitChangeSet,
  loadDashboardRateLimitConfig,
  parseDashboardRateLimitInput,
} from "./dashboard-rate-limit";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("dashboard rate limit", () => {
  it("loads current config from compose env file", () => {
    const dir = mkdtempSync(join(tmpdir(), "fiber-link-rate-limit-"));
    tempDirs.push(dir);
    const envPath = join(dir, ".env");
    writeFileSync(
      envPath,
      [
        "RPC_RATE_LIMIT_ENABLED=false",
        "RPC_RATE_LIMIT_WINDOW_MS=90000",
        "RPC_RATE_LIMIT_MAX_REQUESTS=500",
        "FIBER_LINK_RATE_LIMIT_REDIS_URL=redis://redis:6379/9",
      ].join("\n"),
    );

    expect(loadDashboardRateLimitConfig({ envFilePath: envPath })).toEqual({
      enabled: false,
      windowMs: "90000",
      maxRequests: "500",
      redisUrl: "redis://redis:6379/9",
      sourceLabel: "deploy/compose/.env",
    });
  });

  it("builds env and rollback snippets from changed keys", () => {
    const changeSet = buildDashboardRateLimitChangeSet(
      {
        enabled: true,
        windowMs: "60000",
        maxRequests: "300",
        redisUrl: "redis://redis:6379/1",
        sourceLabel: "deploy/compose/.env",
      },
      {
        enabled: true,
        windowMs: "90000",
        maxRequests: "500",
      },
    );

    expect(changeSet).toEqual({
      changedKeys: ["RPC_RATE_LIMIT_WINDOW_MS", "RPC_RATE_LIMIT_MAX_REQUESTS"],
      envSnippet: "RPC_RATE_LIMIT_WINDOW_MS=90000\nRPC_RATE_LIMIT_MAX_REQUESTS=500",
      rollbackSnippet: "RPC_RATE_LIMIT_WINDOW_MS=60000\nRPC_RATE_LIMIT_MAX_REQUESTS=300",
    });
  });

  it("validates integer inputs", () => {
    expect(() =>
      parseDashboardRateLimitInput({
        enabled: true,
        windowMs: "0",
        maxRequests: "500",
      }),
    ).toThrow("RPC_RATE_LIMIT_WINDOW_MS must be a positive integer");
  });
});
