import { afterEach, describe, expect, it } from "vitest";
import { createInMemoryAppRepo } from "./repositories/app-repo";
import { loadSecretMap, resolveSecretForApp } from "./secret-map";

const originalSecretMap = process.env.FIBER_LINK_HMAC_SECRET_MAP;

afterEach(() => {
  if (originalSecretMap === undefined) {
    delete process.env.FIBER_LINK_HMAC_SECRET_MAP;
  } else {
    process.env.FIBER_LINK_HMAC_SECRET_MAP = originalSecretMap;
  }
});

describe("loadSecretMap", () => {
  it("returns null when no env is set", () => {
    delete process.env.FIBER_LINK_HMAC_SECRET_MAP;
    expect(loadSecretMap()).toBeNull();
  });

  it("parses a valid JSON map", () => {
    process.env.FIBER_LINK_HMAC_SECRET_MAP = JSON.stringify({ app1: "secret" });
    expect(loadSecretMap()).toEqual({ app1: "secret" });
  });

  it("throws on invalid JSON", () => {
    process.env.FIBER_LINK_HMAC_SECRET_MAP = "{invalid";
    expect(() => loadSecretMap()).toThrow("Invalid FIBER_LINK_HMAC_SECRET_MAP");
  });

  it("uses DB secret when app record exists", async () => {
    const appRepo = createInMemoryAppRepo([
      { appId: "app1", hmacSecret: "db-secret" },
    ]);

    const secret = await resolveSecretForApp("app1", {
      appRepo,
      envSecretMap: { app1: "env-map-secret" },
      envFallbackSecret: "env-single-secret",
    });

    expect(secret).toBe("db-secret");
  });

  it("falls back to env map only when DB record is missing", async () => {
    const appRepo = createInMemoryAppRepo([]);

    const secret = await resolveSecretForApp("app1", {
      appRepo,
      envSecretMap: { app1: "env-map-secret" },
      envFallbackSecret: "env-single-secret",
    });

    expect(secret).toBe("env-map-secret");
  });

  it("returns empty secret when neither DB nor env fallback has secret", async () => {
    const appRepo = createInMemoryAppRepo([]);

    const secret = await resolveSecretForApp("app1", {
      appRepo,
      envSecretMap: {},
      envFallbackSecret: "",
    });

    expect(secret).toBe("");
  });
});
