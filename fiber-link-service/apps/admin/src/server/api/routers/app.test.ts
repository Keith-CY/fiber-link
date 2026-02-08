import { describe, expect, it } from "vitest";
import type { DbClient } from "@fiber-link/db";
import { appRouter } from "./app";
import type { TrpcContext } from "../trpc";

function createDbMock({
  appsRows,
  appAdminsRows,
}: {
  appsRows: Array<{ appId: string; createdAt: Date }>;
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
      apps: {
        findMany: async (opts?: any) => {
          let rows = appsRows;
          if (opts?.where) {
            const clause = opts.where({ appId: "appId" }, whereOps);
            if (clause?.type === "inArray") {
              rows = rows.filter((r) => clause.values.includes(r.appId));
            }
          }
          return rows.map((r) => ({ appId: r.appId, createdAt: r.createdAt }));
        },
      },
    },
  } as unknown as DbClient;
}

describe("app router", () => {
  it("returns apps for allowed role", async () => {
    const now = new Date("2026-02-08T00:00:00.000Z");
    const rows = [
      { appId: "app1", createdAt: now },
      { appId: "app2", createdAt: now },
    ];
    const db = createDbMock({ appsRows: rows, appAdminsRows: [] });

    const ctx = { role: "SUPER_ADMIN", db } satisfies TrpcContext;
    const caller = appRouter.createCaller(ctx);
    const result = await caller.list();

    expect(result).toEqual(rows);
  });

  it("scopes COMMUNITY_ADMIN to apps they admin", async () => {
    const now = new Date("2026-02-08T00:00:00.000Z");
    const rows = [
      { appId: "app1", createdAt: now },
      { appId: "app2", createdAt: now },
    ];
    const db = createDbMock({
      appsRows: rows,
      appAdminsRows: [
        { appId: "app1", adminUserId: "au1" },
        { appId: "app2", adminUserId: "au2" },
      ],
    });

    const ctx = { role: "COMMUNITY_ADMIN", adminUserId: "au1", db } satisfies TrpcContext;
    const caller = appRouter.createCaller(ctx);
    const result = await caller.list();

    expect(result).toEqual([{ appId: "app1", createdAt: now }]);
  });

  it("rejects forbidden role", async () => {
    const db = createDbMock({ appsRows: [], appAdminsRows: [] });
    const ctx = { db } satisfies TrpcContext;
    const caller = appRouter.createCaller(ctx);

    await expect(caller.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("fails closed with INTERNAL_SERVER_ERROR when DB is missing", async () => {
    const ctx = { role: "SUPER_ADMIN" } satisfies TrpcContext;
    const caller = appRouter.createCaller(ctx);

    await expect(caller.list()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("fails closed with INTERNAL_SERVER_ERROR when COMMUNITY_ADMIN has no identity", async () => {
    const db = createDbMock({ appsRows: [], appAdminsRows: [] });
    const ctx = { role: "COMMUNITY_ADMIN", db } satisfies TrpcContext;
    const caller = appRouter.createCaller(ctx);

    await expect(caller.list()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});
