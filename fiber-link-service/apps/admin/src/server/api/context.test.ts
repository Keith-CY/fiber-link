import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CreateNextContextOptions } from "@trpc/server/adapters/next";
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

  it("uses the first value when a header arrives as an array", () => {
    const ctx = createTrpcContext(reqWith({ "x-admin-role": ["SUPER_ADMIN", "COMMUNITY_ADMIN"] }));
    expect(ctx.role).toBe("SUPER_ADMIN");
  });

  it("leaves the role undefined for an unrecognized header", () => {
    const ctx = createTrpcContext(reqWith({ "x-admin-role": "ROOT" }));
    expect(ctx.role).toBeUndefined();
  });
});
