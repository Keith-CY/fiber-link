import { describe, it, expect } from "vitest";
import { loadSecretMap } from "./secret-map";

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
});
