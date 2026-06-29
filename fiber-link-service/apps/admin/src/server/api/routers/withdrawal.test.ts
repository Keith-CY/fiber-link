import { describe, expect, it } from "vitest";
import type { DbClient } from "@fiber-link/db";
import { withdrawalRouter } from "./withdrawal";
import type { TrpcContext } from "../trpc";

type WithdrawalRow = {
  id: string;
  appId: string;
  userId: string;
  asset: "CKB" | "USDI";
  amount: string;
  destinationKind: "CKB_ADDRESS" | "PAYMENT_REQUEST";
  toAddress: string;
  state: string;
  retryCount: number;
  nextRetryAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  txHash: string | null;
  liquidityRequestId: string | null;
  liquidityPendingReason: string | null;
  liquidityCheckedAt: Date | null;
};

function baseWithdrawal(overrides: Partial<WithdrawalRow> = {}): WithdrawalRow {
  const now = new Date("2026-02-08T00:00:00.000Z");
  return {
    id: "w1",
    appId: "app1",
    userId: "u1",
    asset: "USDI",
    amount: "10",
    destinationKind: "CKB_ADDRESS",
    toAddress: "ckt1q...",
    state: "PENDING",
    retryCount: 0,
    nextRetryAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    txHash: null,
    liquidityRequestId: null,
    liquidityPendingReason: null,
    liquidityCheckedAt: null,
    ...overrides,
  };
}

function createDbMock({
  withdrawalsRows,
  appAdminsRows,
}: {
  withdrawalsRows: WithdrawalRow[];
  appAdminsRows: Array<{ appId: string; adminUserId: string }>;
}): DbClient & { auditEvents: unknown[] } {
  const auditEvents: unknown[] = [];
  type Clause =
    | { type: "and"; clauses: Clause[] }
    | { type: "eq"; field: keyof WithdrawalRow; value: unknown }
    | { type: "inArray"; field: keyof WithdrawalRow; values: unknown[] }
    | { type: "lte" | "gte"; field: keyof WithdrawalRow; value: Date };

  const whereOps = {
    and: (...clauses: Clause[]) => ({ type: "and" as const, clauses }),
    eq: (field: keyof WithdrawalRow, value: unknown) => ({ type: "eq" as const, field, value }),
    inArray: (field: keyof WithdrawalRow, values: unknown[]) => ({ type: "inArray" as const, field, values }),
    lte: (field: keyof WithdrawalRow, value: Date) => ({ type: "lte" as const, field, value }),
    gte: (field: keyof WithdrawalRow, value: Date) => ({ type: "gte" as const, field, value }),
  };

  function matchesClause(row: WithdrawalRow, clause: Clause | undefined): boolean {
    if (!clause || !("type" in clause)) return true;
    if (clause.type === "and") return clause.clauses.every((item) => matchesClause(row, item));
    if (clause.type === "eq") return row[clause.field] === clause.value;
    if (clause.type === "inArray") return clause.values.includes(row[clause.field]);
    if (clause.type === "lte" || clause.type === "gte") {
      const value = row[clause.field];
      if (!(value instanceof Date)) return false;
      return clause.type === "lte" ? value <= clause.value : value >= clause.value;
    }
    return true;
  }

  return {
    auditEvents,
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
            const clause = opts.where(
              {
                id: "id",
                appId: "appId",
                userId: "userId",
                state: "state",
                txHash: "txHash",
                createdAt: "createdAt",
              },
              whereOps,
            );
            rows = rows.filter((row) => matchesClause(row, clause));
          }
          return rows;
        },
      },
    },
    update: () => {
      let values: Record<string, unknown> = {};
      let clause: Clause | undefined;
      return {
        set(nextValues: Record<string, unknown>) {
          values = nextValues;
          return this;
        },
        where(nextClause: Clause) {
          clause = nextClause;
          return this;
        },
        returning: async () => {
          const row = withdrawalsRows.find((item) => matchesClause(item, clause));
          if (!row) return [];
          Object.assign(row, values);
          return [row];
        },
      };
    },
    insert: () => ({
      values: async (event: unknown) => {
        auditEvents.push(event);
      },
    }),
  } as unknown as DbClient & { auditEvents: unknown[] };
}

describe("withdrawal router", () => {
  it("returns withdrawals for allowed role with queue fields", async () => {
    const rows = [baseWithdrawal({ txHash: "0xabc" })];
    const db = createDbMock({ withdrawalsRows: rows, appAdminsRows: [] });

    const ctx = { role: "SUPER_ADMIN", db } satisfies TrpcContext;
    const caller = withdrawalRouter.createCaller(ctx);
    const result = await caller.list({});

    expect(result[0]).toMatchObject({
      id: "w1",
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "10",
      destinationKind: "CKB_ADDRESS",
      state: "PENDING",
      retryCount: 0,
      txHash: "0xabc",
      txExplorerUrl: "https://explorer.nervos.org/transaction/0xabc",
    });
    expect(result[0]?.ageSeconds).toBeGreaterThanOrEqual(0);
  });

  it("filters withdrawals by state, app, user, age, and tx hash", async () => {
    const now = new Date();
    const rows = [
      baseWithdrawal({ id: "match", appId: "app1", userId: "u1", state: "FAILED", txHash: "0xabc", createdAt: new Date(now.getTime() - 3_600_000) }),
      baseWithdrawal({ id: "miss", appId: "app2", userId: "u2", state: "PENDING", txHash: "0xdef", createdAt: now }),
    ];
    const db = createDbMock({ withdrawalsRows: rows, appAdminsRows: [] });
    const caller = withdrawalRouter.createCaller({ role: "SUPER_ADMIN", db } satisfies TrpcContext);

    const result = await caller.list({ state: "FAILED", appId: "app1", userId: "u1", txHash: "abc", minAgeSeconds: 60 });

    expect(result.map((row) => row.id)).toEqual(["match"]);
  });

  it("scopes COMMUNITY_ADMIN to withdrawals for apps they admin", async () => {
    const rows = [baseWithdrawal({ id: "w1", appId: "app1" }), baseWithdrawal({ id: "w2", appId: "app2", userId: "u2" })];
    const db = createDbMock({
      withdrawalsRows: rows,
      appAdminsRows: [
        { appId: "app1", adminUserId: "au1" },
        { appId: "app2", adminUserId: "au2" },
      ],
    });

    const ctx = { role: "COMMUNITY_ADMIN", adminUserId: "au1", db } satisfies TrpcContext;
    const caller = withdrawalRouter.createCaller(ctx);
    const result = await caller.list({});

    expect(result.map((row) => row.id)).toEqual(["w1"]);
  });

  it("writes an audit event for retryNow", async () => {
    const rows = [baseWithdrawal({ state: "FAILED", lastError: "boom" })];
    const db = createDbMock({ withdrawalsRows: rows, appAdminsRows: [] });
    const caller = withdrawalRouter.createCaller({ role: "SUPER_ADMIN", adminUserId: "admin-1", db } satisfies TrpcContext);

    const result = await caller.retryNow({ id: "w1", reason: "operator retry", requestId: "req-1" });

    expect(result.state).toBe("PENDING");
    expect(result.lastError).toBeNull();
    expect(db.auditEvents).toHaveLength(1);
    expect(db.auditEvents[0]).toMatchObject({
      actorId: "admin-1",
      actorRole: "SUPER_ADMIN",
      action: "withdrawal.retryNow",
      targetType: "withdrawal",
      targetId: "w1",
      requestId: "req-1",
      reason: "operator retry",
    });
  });

  it("does not re-queue failed withdrawals that already have a broadcast tx", async () => {
    const db = createDbMock({ withdrawalsRows: [baseWithdrawal({ state: "FAILED", txHash: "0xpaid" })], appAdminsRows: [] });
    const caller = withdrawalRouter.createCaller({ role: "SUPER_ADMIN", adminUserId: "admin-1", db } satisfies TrpcContext);

    await expect(caller.retryNow({ id: "w1" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(caller.resume({ id: "w1" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects PROCESSING manual broadcast/cancel actions to avoid worker races", async () => {
    const db = createDbMock({ withdrawalsRows: [baseWithdrawal({ state: "PROCESSING" })], appAdminsRows: [] });
    const caller = withdrawalRouter.createCaller({ role: "SUPER_ADMIN", adminUserId: "admin-1", db } satisfies TrpcContext);

    await expect(caller.attachTx({ id: "w1", txHash: "0xabc" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(caller.cancelBeforeBroadcast({ id: "w1", reason: "stop" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("appends ops notes instead of replacing the original error", async () => {
    const db = createDbMock({ withdrawalsRows: [baseWithdrawal({ state: "FAILED", lastError: "broadcast failed" })], appAdminsRows: [] });
    const caller = withdrawalRouter.createCaller({ role: "SUPER_ADMIN", adminUserId: "admin-1", db } satisfies TrpcContext);

    const result = await caller.addOpsNote({ id: "w1", note: "watching retry" });

    expect(result.lastError).toBe("broadcast failed\nOps note: watching retry");
  });

  it("denies manual actions when admin actor is missing", async () => {
    const db = createDbMock({ withdrawalsRows: [baseWithdrawal({ state: "FAILED" })], appAdminsRows: [] });
    const caller = withdrawalRouter.createCaller({ role: "SUPER_ADMIN", db } satisfies TrpcContext);

    await expect(caller.retryNow({ id: "w1" })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("rejects invalid attachTx transitions", async () => {
    const db = createDbMock({ withdrawalsRows: [baseWithdrawal({ state: "COMPLETED" })], appAdminsRows: [] });
    const caller = withdrawalRouter.createCaller({ role: "SUPER_ADMIN", adminUserId: "admin-1", db } satisfies TrpcContext);

    await expect(caller.attachTx({ id: "w1", txHash: "0xabc" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects forbidden role", async () => {
    const db = createDbMock({ withdrawalsRows: [], appAdminsRows: [] });
    const ctx = { db } satisfies TrpcContext;
    const caller = withdrawalRouter.createCaller(ctx);

    await expect(caller.list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("fails closed with INTERNAL_SERVER_ERROR when DB is missing", async () => {
    const ctx = { role: "SUPER_ADMIN" } satisfies TrpcContext;
    const caller = withdrawalRouter.createCaller(ctx);

    await expect(caller.list({})).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("fails closed with INTERNAL_SERVER_ERROR when COMMUNITY_ADMIN has no identity", async () => {
    const db = createDbMock({ withdrawalsRows: [], appAdminsRows: [] });
    const ctx = { role: "COMMUNITY_ADMIN", db } satisfies TrpcContext;
    const caller = withdrawalRouter.createCaller(ctx);

    await expect(caller.list({})).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("returns empty list when COMMUNITY_ADMIN has no app memberships", async () => {
    const db = createDbMock({
      withdrawalsRows: [baseWithdrawal()],
      appAdminsRows: [{ appId: "app2", adminUserId: "au2" }],
    });

    const ctx = { role: "COMMUNITY_ADMIN", adminUserId: "au1", db } satisfies TrpcContext;
    const caller = withdrawalRouter.createCaller(ctx);
    const result = await caller.list({});

    expect(result).toEqual([]);
  });
});
