import { describe, expect, it } from "vitest";
import type { DbClient } from "@fiber-link/db";
import { withdrawalPolicyRouter } from "./withdrawal-policy";
import type { TrpcContext } from "../trpc";

type PolicyRow = {
  appId: string;
  allowedAssets: Array<"CKB" | "USDI">;
  maxPerRequest: string;
  perUserDailyMax: string;
  perAppDailyMax: string;
  cooldownSeconds: number;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function createDbMock({
  policiesRows,
  appAdminsRows,
}: {
  policiesRows: PolicyRow[];
  appAdminsRows: Array<{ appId: string; adminUserId: string }>;
}): DbClient {
  const whereOps = {
    eq: (_: unknown, value: unknown) => ({ type: "eq" as const, value }),
    inArray: (_: unknown, values: unknown[]) => ({ type: "inArray" as const, values }),
  };

  return {
    query: {
      appAdmins: {
        findMany: async (opts?: any) => {
          let rows = appAdminsRows;
          if (opts?.where) {
            const clause = opts.where({ adminUserId: "adminUserId" }, whereOps);
            if (clause?.type === "eq") {
              rows = rows.filter((r) => r.adminUserId === clause.value);
            }
          }
          return rows.map((r) => ({ appId: r.appId }));
        },
      },
      withdrawalPolicies: {
        findMany: async (opts?: any) => {
          let rows = policiesRows;
          if (opts?.where) {
            const clause = opts.where({ appId: "appId" }, whereOps);
            if (clause?.type === "inArray") {
              rows = rows.filter((r) => clause.values.includes(r.appId));
            }
            if (clause?.type === "eq") {
              rows = rows.filter((r) => r.appId === clause.value);
            }
          }
          return rows.map((row) => ({ ...row }));
        },
      },
    },
    insert: () => ({
      values: (input: any) => ({
        onConflictDoUpdate: async ({ set }: any) => {
          const existing = policiesRows.find((row) => row.appId === input.appId);
          if (existing) {
            existing.allowedAssets = [...(set.allowedAssets ?? existing.allowedAssets)];
            existing.maxPerRequest = String(set.maxPerRequest ?? existing.maxPerRequest);
            existing.perUserDailyMax = String(set.perUserDailyMax ?? existing.perUserDailyMax);
            existing.perAppDailyMax = String(set.perAppDailyMax ?? existing.perAppDailyMax);
            existing.cooldownSeconds = Number(set.cooldownSeconds ?? existing.cooldownSeconds);
            existing.updatedBy = set.updatedBy ?? existing.updatedBy;
            existing.updatedAt = set.updatedAt ?? existing.updatedAt;
            return;
          }

          policiesRows.push({
            appId: String(input.appId),
            allowedAssets: [...input.allowedAssets],
            maxPerRequest: String(input.maxPerRequest),
            perUserDailyMax: String(input.perUserDailyMax),
            perAppDailyMax: String(input.perAppDailyMax),
            cooldownSeconds: Number(input.cooldownSeconds),
            updatedBy: input.updatedBy ?? null,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          });
        },
      }),
    }),
  } as unknown as DbClient;
}

describe("withdrawal policy router", () => {
  it("returns all policies for SUPER_ADMIN", async () => {
    const now = new Date("2026-02-27T00:00:00.000Z");
    const rows: PolicyRow[] = [
      {
        appId: "app1",
        allowedAssets: ["CKB"],
        maxPerRequest: "5000",
        perUserDailyMax: "20000",
        perAppDailyMax: "200000",
        cooldownSeconds: 0,
        updatedBy: "admin-1",
        createdAt: now,
        updatedAt: now,
      },
    ];
    const db = createDbMock({ policiesRows: rows, appAdminsRows: [] });

    const caller = withdrawalPolicyRouter.createCaller({ role: "SUPER_ADMIN", db } satisfies TrpcContext);
    const result = await caller.list();

    expect(result).toEqual(rows);
  });

  it("scopes policies for COMMUNITY_ADMIN", async () => {
    const now = new Date("2026-02-27T00:00:00.000Z");
    const rows: PolicyRow[] = [
      {
        appId: "app1",
        allowedAssets: ["CKB"],
        maxPerRequest: "5000",
        perUserDailyMax: "20000",
        perAppDailyMax: "200000",
        cooldownSeconds: 0,
        updatedBy: "admin-1",
        createdAt: now,
        updatedAt: now,
      },
      {
        appId: "app2",
        allowedAssets: ["USDI"],
        maxPerRequest: "50",
        perUserDailyMax: "500",
        perAppDailyMax: "5000",
        cooldownSeconds: 60,
        updatedBy: "admin-2",
        createdAt: now,
        updatedAt: now,
      },
    ];
    const db = createDbMock({
      policiesRows: rows,
      appAdminsRows: [
        { appId: "app1", adminUserId: "au1" },
        { appId: "app2", adminUserId: "au2" },
      ],
    });

    const caller = withdrawalPolicyRouter.createCaller({
      role: "COMMUNITY_ADMIN",
      adminUserId: "au1",
      db,
    } satisfies TrpcContext);
    const result = await caller.list();

    expect(result).toEqual([rows[0]]);
  });

  it("upserts policy for SUPER_ADMIN", async () => {
    const db = createDbMock({ policiesRows: [], appAdminsRows: [] });

    const caller = withdrawalPolicyRouter.createCaller({ role: "SUPER_ADMIN", db } satisfies TrpcContext);
    const result = await caller.upsert({
      appId: "app1",
      allowedAssets: ["CKB"],
      maxPerRequest: "5000",
      perUserDailyMax: "20000",
      perAppDailyMax: "200000",
      cooldownSeconds: 0,
      updatedBy: "admin-1",
    });

    expect(result.appId).toBe("app1");
    expect(result.allowedAssets).toEqual(["CKB"]);
    expect(String(result.maxPerRequest)).toBe("5000");
  });

  it("rejects COMMUNITY_ADMIN upsert for unmanaged app", async () => {
    const db = createDbMock({
      policiesRows: [],
      appAdminsRows: [{ appId: "app2", adminUserId: "au2" }],
    });

    const caller = withdrawalPolicyRouter.createCaller({
      role: "COMMUNITY_ADMIN",
      adminUserId: "au1",
      db,
    } satisfies TrpcContext);

    await expect(
      caller.upsert({
        appId: "app1",
        allowedAssets: ["CKB"],
        maxPerRequest: "5000",
        perUserDailyMax: "20000",
        perAppDailyMax: "200000",
        cooldownSeconds: 0,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects upsert when maxPerRequest exceeds perUserDailyMax", async () => {
    const db = createDbMock({ policiesRows: [], appAdminsRows: [] });
    const caller = withdrawalPolicyRouter.createCaller({ role: "SUPER_ADMIN", db } satisfies TrpcContext);

    await expect(
      caller.upsert({
        appId: "app1",
        allowedAssets: ["CKB"],
        maxPerRequest: "200",
        perUserDailyMax: "100",
        perAppDailyMax: "1000",
        cooldownSeconds: 0,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "maxPerRequest must be <= perUserDailyMax",
    });
  });
});
