import { describe, expect, it } from "vitest";
import type { WithdrawalPolicyRecord } from "@fiber-link/db";
import { handleDashboardPolicyAction } from "./dashboard-policy-action";

function createPolicyRecord(overrides: Partial<WithdrawalPolicyRecord> = {}): WithdrawalPolicyRecord {
  return {
    appId: "app-beta",
    allowedAssets: ["CKB", "USDI"],
    maxPerRequest: "1500",
    perUserDailyMax: "4500",
    perAppDailyMax: "25000",
    cooldownSeconds: 45,
    updatedBy: "admin-2",
    createdAt: new Date("2026-03-18T00:00:00.000Z"),
    updatedAt: new Date("2026-03-18T00:00:00.000Z"),
    ...overrides,
  };
}

describe("dashboard policy action", () => {
  it("uses trusted headers and redirects back with a success flash", async () => {
    const result = await handleDashboardPolicyAction(
      {
        roleHeader: "SUPER_ADMIN",
        adminUserIdHeader: "admin-2",
        body: {
          appId: "app-beta",
          allowedAssets: ["USDI", "CKB"],
          maxPerRequest: "1500",
          perUserDailyMax: "4500",
          perAppDailyMax: "25000",
          cooldownSeconds: "45",
        },
      },
      {
        createDb: () => ({} as never),
        upsertPolicy: async ({ ctx, input }) => {
          expect(ctx.role).toBe("SUPER_ADMIN");
          expect(ctx.adminUserId).toBe("admin-2");
          expect(input).toEqual({
            appId: "app-beta",
            allowedAssets: ["USDI", "CKB"],
            maxPerRequest: "1500",
            perUserDailyMax: "4500",
            perAppDailyMax: "25000",
            cooldownSeconds: 45,
          });
          return createPolicyRecord({
            appId: input.appId,
            allowedAssets: input.allowedAssets,
            updatedBy: ctx.adminUserId ?? null,
          });
        },
      },
    );

    expect(result).toEqual({
      location: "/?savedAppId=app-beta",
      statusCode: 303,
    });
  });

  it("falls back to env-backed trusted identity for local fixture proof mode", async () => {
    const result = await handleDashboardPolicyAction(
      {
        body: {
          appId: "app-beta",
          allowedAssets: "USDI",
          maxPerRequest: "1500",
          perUserDailyMax: "4500",
          perAppDailyMax: "25000",
          cooldownSeconds: "45",
        },
      },
      {
        env: {
          ADMIN_DASHBOARD_DEFAULT_ROLE: "COMMUNITY_ADMIN",
          ADMIN_DASHBOARD_DEFAULT_ADMIN_USER_ID: "fixture-admin",
        } as NodeJS.ProcessEnv,
        createDb: () => ({} as never),
        upsertPolicy: async ({ ctx }) => {
          expect(ctx.role).toBe("COMMUNITY_ADMIN");
          expect(ctx.adminUserId).toBe("fixture-admin");
          return createPolicyRecord();
        },
      },
    );

    expect(result.location).toBe("/?savedAppId=app-beta");
  });

  it("redirects back with draft values when validation fails", async () => {
    const result = await handleDashboardPolicyAction(
      {
        roleHeader: "SUPER_ADMIN",
        adminUserIdHeader: "admin-2",
        body: {
          appId: "app-beta",
          allowedAssets: ["USDI"],
          maxPerRequest: "9000",
          perUserDailyMax: "4500",
          perAppDailyMax: "25000",
          cooldownSeconds: "45",
        },
      },
      {
        createDb: () => ({} as never),
        upsertPolicy: async () => createPolicyRecord(),
      },
    );

    expect(result.statusCode).toBe(303);
    expect(result.location).toContain("formError=maxPerRequest+must+be+%3C%3D+perUserDailyMax");
    expect(result.location).toContain("draftAllowedAssets=USDI");
    expect(result.location).toContain("draftAppId=app-beta");
  });
});
