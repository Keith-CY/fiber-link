import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { validateRpcEnv } from "./env";
import { closeSharedStreamResources, registerStreamRoute } from "./stream";

const VALID_ENV = {
  DATABASE_URL: "postgresql://fiber:pw@localhost:5432/fiber_link",
  FIBER_RPC_URL: "http://fnn:8227",
  FIBER_LINK_HMAC_SECRET: "secret",
  FIBER_LINK_NONCE_REDIS_URL: "redis://localhost:6379/0",
};

describe("validateRpcEnv", () => {
  it("passes a fully configured environment", () => {
    expect(validateRpcEnv(VALID_ENV)).toEqual({ errors: [], warnings: [] });
  });

  it("errors when DATABASE_URL is missing or blank", () => {
    const { errors } = validateRpcEnv({ ...VALID_ENV, DATABASE_URL: "  " });
    expect(errors.some((e) => e.includes("DATABASE_URL"))).toBe(true);
  });

  it("errors when FIBER_RPC_URL is missing in rpc adapter mode", () => {
    const { errors } = validateRpcEnv({ ...VALID_ENV, FIBER_RPC_URL: undefined });
    expect(errors.some((e) => e.includes("FIBER_RPC_URL"))).toBe(true);
  });

  it("does not require FIBER_RPC_URL in simulation adapter mode", () => {
    const { errors } = validateRpcEnv({
      ...VALID_ENV,
      FIBER_RPC_URL: undefined,
      FIBER_ADAPTER_MODE: "simulation",
    });
    expect(errors).toEqual([]);
  });

  it("warns when the HMAC env fallback secret is unset", () => {
    const { errors, warnings } = validateRpcEnv({ ...VALID_ENV, FIBER_LINK_HMAC_SECRET: undefined });
    expect(errors).toEqual([]);
    expect(warnings.some((w) => w.includes("FIBER_LINK_HMAC_SECRET"))).toBe(true);
  });

  it("warns when no Redis URL is configured for the nonce store", () => {
    const { errors, warnings } = validateRpcEnv({
      ...VALID_ENV,
      FIBER_LINK_NONCE_REDIS_URL: undefined,
      REDIS_URL: undefined,
    });
    expect(errors).toEqual([]);
    expect(warnings.some((w) => w.includes("Redis"))).toBe(true);
  });

  it("accepts REDIS_URL as the nonce store fallback", () => {
    const { warnings } = validateRpcEnv({
      ...VALID_ENV,
      FIBER_LINK_NONCE_REDIS_URL: undefined,
      REDIS_URL: "redis://localhost:6379",
    });
    expect(warnings.some((w) => w.includes("Redis"))).toBe(false);
  });
});

describe("shared stream resource cleanup", () => {
  it("closeSharedStreamResources is idempotent without an active connection", async () => {
    await expect(closeSharedStreamResources()).resolves.toBeUndefined();
    await expect(closeSharedStreamResources()).resolves.toBeUndefined();
  });

  it("app.close() triggers the stream onClose cleanup hook", async () => {
    const app = Fastify({ logger: false });
    registerStreamRoute(app);
    await app.ready();
    // No shared connection was opened, so close must resolve cleanly through
    // the onClose hook (exercises the wiring, not a live Redis).
    await expect(app.close()).resolves.toBeUndefined();
  });
});
