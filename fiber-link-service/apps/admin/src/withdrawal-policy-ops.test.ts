import { describe, expect, it } from "vitest";
import type { WithdrawalPolicyRecord } from "@fiber-link/db";
import { parseWithdrawalPolicyCommand, runWithdrawalPolicyCommand } from "./withdrawal-policy-ops";

function createPolicyRecord(overrides: Partial<WithdrawalPolicyRecord> = {}): WithdrawalPolicyRecord {
  return {
    appId: "app-1",
    allowedAssets: ["CKB", "USDI"],
    maxPerRequest: "5000",
    perUserDailyMax: "20000",
    perAppDailyMax: "200000",
    cooldownSeconds: 120,
    updatedBy: "admin-1",
    createdAt: new Date("2026-03-18T00:00:00.000Z"),
    updatedAt: new Date("2026-03-18T00:00:00.000Z"),
    ...overrides,
  };
}

describe("withdrawal policy ops", () => {
  it("parses list command using trusted role from env", () => {
    const command = parseWithdrawalPolicyCommand(["list"], {
      ADMIN_ROLE: "COMMUNITY_ADMIN",
      ADMIN_USER_ID: "admin-42",
    } as NodeJS.ProcessEnv);

    expect(command).toEqual({
      action: "list",
      role: "COMMUNITY_ADMIN",
      adminUserId: "admin-42",
    });
  });

  it("rejects upsert when admin actor is missing", () => {
    expect(() =>
      parseWithdrawalPolicyCommand(
        [
          "upsert",
          "--app-id=app-1",
          "--allowed-assets=CKB,USDI",
          "--max-per-request=5000",
          "--per-user-daily-max=20000",
          "--per-app-daily-max=200000",
          "--cooldown-seconds=120",
        ],
        {
          ADMIN_ROLE: "SUPER_ADMIN",
        } as NodeJS.ProcessEnv,
      ),
    ).toThrow("ADMIN_USER_ID is required");
  });

  it("executes upsert with trusted actor metadata", async () => {
    const command = parseWithdrawalPolicyCommand(
      [
        "upsert",
        "--app-id=app-1",
        "--allowed-assets=CKB,USDI",
        "--max-per-request=5000",
        "--per-user-daily-max=20000",
        "--per-app-daily-max=200000",
        "--cooldown-seconds=120",
      ],
      {
        ADMIN_ROLE: "SUPER_ADMIN",
        ADMIN_USER_ID: "admin-1",
      } as NodeJS.ProcessEnv,
    );

    const result = await runWithdrawalPolicyCommand(command, {
      listPolicies: async () => [],
      upsertPolicy: async ({ ctx, input }) => {
        expect(ctx.role).toBe("SUPER_ADMIN");
        expect(ctx.adminUserId).toBe("admin-1");
        expect(input.appId).toBe("app-1");
        return createPolicyRecord({
          appId: input.appId,
          updatedBy: ctx.adminUserId ?? null,
        });
      },
    });

    expect(result).toMatchObject({
      action: "upsert",
      actor: {
        role: "SUPER_ADMIN",
        adminUserId: "admin-1",
      },
      policy: {
        appId: "app-1",
        updatedBy: "admin-1",
      },
    });
  });

  it("returns list output with actor metadata", async () => {
    const command = parseWithdrawalPolicyCommand(["list", "--role=SUPER_ADMIN"], {} as NodeJS.ProcessEnv);

    const result = await runWithdrawalPolicyCommand(command, {
      listPolicies: async ({ ctx }) => {
        expect(ctx.role).toBe("SUPER_ADMIN");
        return [createPolicyRecord()];
      },
      upsertPolicy: async () => createPolicyRecord(),
    });

    expect(result).toMatchObject({
      action: "list",
      actor: {
        role: "SUPER_ADMIN",
        adminUserId: null,
      },
      policies: [
        {
          appId: "app-1",
        },
      ],
    });
  });
});
