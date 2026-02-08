import { describe, expect, it } from "vitest";
import type { DbClient } from "@fiber-link/db";
import { withdrawalRouter } from "./withdrawal";
import type { TrpcContext } from "../trpc";

function createDbMock({
  withdrawalsRows,
  appAdminsRows,
}: {
  withdrawalsRows: Array<{
    id: string;
    appId: string;
    userId: string;
    asset: string;
    amount: string;
    toAddress: string;
    state: string;
    retryCount: number;
    nextRetryAt: Date | null;
    lastError: string | null;
    createdAt: Date;
    updatedAt: Date;
    completedAt: Date | null;
  }>;
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
      withdrawals: {
        findMany: async (opts?: any) => {
          let rows = withdrawalsRows;
          if (opts?.where) {
            const clause = opts.where({ appId: "appId" }, whereOps);
            if (clause?.type === "inArray") {
              rows = rows.filter((r) => clause.values.includes(r.appId));
            }
          }
          return rows;
        },
      },
    },
  } as unknown as DbClient;
}

describe("withdrawal router", () => {
  it("returns withdrawals for allowed role", async () => {
    const now = new Date("2026-02-08T00:00:00.000Z");
    const rows = [
      {
        id: "w1",
        appId: "app1",
        userId: "u1",
        asset: "USDI",
        amount: "10",
        toAddress: "ckt1q...",
        state: "PENDING",
        retryCount: 0,
        nextRetryAt: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      },
    ];
    const db = createDbMock({ withdrawalsRows: rows, appAdminsRows: [] });

    const ctx = { role: "SUPER_ADMIN", db } satisfies TrpcContext;
    const caller = withdrawalRouter.createCaller(ctx);
    const result = await caller.list();

    expect(result).toEqual(rows);
  });

  it("scopes COMMUNITY_ADMIN to withdrawals for apps they admin", async () => {
    const now = new Date("2026-02-08T00:00:00.000Z");
    const rows = [
      {
        id: "w1",
        appId: "app1",
        userId: "u1",
        asset: "USDI",
        amount: "10",
        toAddress: "ckt1q...",
        state: "PENDING",
        retryCount: 0,
        nextRetryAt: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      },
      {
        id: "w2",
        appId: "app2",
        userId: "u2",
        asset: "USDI",
        amount: "20",
        toAddress: "ckt1q...",
        state: "PENDING",
        retryCount: 0,
        nextRetryAt: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      },
    ];
    const db = createDbMock({
      withdrawalsRows: rows,
      appAdminsRows: [
        { appId: "app1", adminUserId: "au1" },
        { appId: "app2", adminUserId: "au2" },
      ],
    });

    const ctx = { role: "COMMUNITY_ADMIN", adminUserId: "au1", db } satisfies TrpcContext;
    const caller = withdrawalRouter.createCaller(ctx);
    const result = await caller.list();

    expect(result).toEqual([rows[0]]);
  });

  it("rejects forbidden role", async () => {
    const db = createDbMock({ withdrawalsRows: [], appAdminsRows: [] });
    const ctx = { role: "USER", db } satisfies TrpcContext;
    const caller = withdrawalRouter.createCaller(ctx);

    await expect(caller.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("fails closed with INTERNAL_SERVER_ERROR when DB is missing", async () => {
    const ctx = { role: "SUPER_ADMIN" } satisfies TrpcContext;
    const caller = withdrawalRouter.createCaller(ctx);

    await expect(caller.list()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("fails closed with INTERNAL_SERVER_ERROR when COMMUNITY_ADMIN has no identity", async () => {
    const db = createDbMock({ withdrawalsRows: [], appAdminsRows: [] });
    const ctx = { role: "COMMUNITY_ADMIN", db } satisfies TrpcContext;
    const caller = withdrawalRouter.createCaller(ctx);

    await expect(caller.list()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});
