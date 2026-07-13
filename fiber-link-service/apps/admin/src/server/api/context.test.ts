import type { CreateNextContextOptions } from "@trpc/server/adapters/next";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTrpcContext } from "./context";

function reqWith(headers: Record<string, string | string[] | undefined>): CreateNextContextOptions {
  return { req: { headers } } as unknown as CreateNextContextOptions;
}

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env.ADMIN_DASHBOARD_FIXTURE_PATH = "fixtures/dashboard-proof.json";
  delete process.env.ADMIN_DASHBOARD_DEFAULT_ROLE;
  delete process.env.ADMIN_DASHBOARD_DEFAULT_ADMIN_USER_ID;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("createTrpcContext", () => {
  it("resolves the trusted role and admin id from request headers", async () => {
    const ctx = createTrpcContext(reqWith({ "x-admin-role": "SUPER_ADMIN", "x-admin-user-id": "ops-7" }));
    expect(ctx.role).toBe("SUPER_ADMIN");
    expect(ctx.adminUserId).toBe("ops-7");
    expect((await ctx.services.listApps({ role: "SUPER_ADMIN" })).length).toBeGreaterThan(0);
  });

  it("falls back to the development env defaults when headers are absent", () => {
    process.env.ADMIN_DASHBOARD_DEFAULT_ROLE = "COMMUNITY_ADMIN";
    process.env.ADMIN_DASHBOARD_DEFAULT_ADMIN_USER_ID = "default-admin";
    const ctx = createTrpcContext(reqWith({}));
    expect(ctx.role).toBe("COMMUNITY_ADMIN");
    expect(ctx.adminUserId).toBe("default-admin");
  });

  it("ignores the env default identity in production when headers are absent", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.ADMIN_DASHBOARD_DEFAULT_ROLE = "SUPER_ADMIN";
    process.env.ADMIN_DASHBOARD_DEFAULT_ADMIN_USER_ID = "default-admin";
    const ctx = createTrpcContext(reqWith({}));
    expect(ctx.role).toBeUndefined();
    expect(ctx.adminUserId).toBeUndefined();
  });

  it("still honors injected headers in production", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    const ctx = createTrpcContext(reqWith({ "x-admin-role": "SUPER_ADMIN", "x-admin-user-id": "ops-9" }));
    expect(ctx.role).toBe("SUPER_ADMIN");
    expect(ctx.adminUserId).toBe("ops-9");
  });

  it("uses the first value when a header arrives as an array", () => {
    const ctx = createTrpcContext(reqWith({ "x-admin-role": ["SUPER_ADMIN", "COMMUNITY_ADMIN"] }));
    expect(ctx.role).toBe("SUPER_ADMIN");
  });

  it("leaves the role undefined for an unrecognized header", () => {
    const ctx = createTrpcContext(reqWith({ "x-admin-role": "ROOT" }));
    expect(ctx.role).toBeUndefined();
  });

  describe("with ADMIN_PROXY_SHARED_SECRET configured", () => {
    beforeEach(() => {
      process.env.ADMIN_PROXY_SHARED_SECRET = "proxy-secret";
    });

    it("honors identity headers when the proxy token matches", () => {
      const ctx = createTrpcContext(
        reqWith({
          "x-admin-proxy-token": "proxy-secret",
          "x-admin-role": "SUPER_ADMIN",
          "x-admin-user-id": "ops-7",
        }),
      );
      expect(ctx.role).toBe("SUPER_ADMIN");
      expect(ctx.adminUserId).toBe("ops-7");
    });

    it("fails closed when the proxy token mismatches", () => {
      const ctx = createTrpcContext(
        reqWith({
          "x-admin-proxy-token": "wrong",
          "x-admin-role": "SUPER_ADMIN",
          "x-admin-user-id": "ops-7",
        }),
      );
      expect(ctx.role).toBeUndefined();
      expect(ctx.adminUserId).toBeUndefined();
    });

    it("fails closed when the proxy token is absent", () => {
      const ctx = createTrpcContext(reqWith({ "x-admin-role": "SUPER_ADMIN" }));
      expect(ctx.role).toBeUndefined();
    });

    it("skips the dev env fallback identity on token mismatch", () => {
      process.env.ADMIN_DASHBOARD_DEFAULT_ROLE = "SUPER_ADMIN";
      process.env.ADMIN_DASHBOARD_DEFAULT_ADMIN_USER_ID = "default-admin";
      const ctx = createTrpcContext(reqWith({ "x-admin-proxy-token": "wrong" }));
      expect(ctx.role).toBeUndefined();
      expect(ctx.adminUserId).toBeUndefined();
    });
  });
});
