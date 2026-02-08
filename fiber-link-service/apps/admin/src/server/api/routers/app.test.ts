import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { apps } from "@fiber-link/db";
import { appRouter } from "./app";

function createDbMock(tableRows: Map<unknown, unknown[]>) {
  return {
    select: () => ({
      from: (table: unknown) => Promise.resolve(tableRows.get(table) ?? []),
    }),
  };
}

describe("app router", () => {
  it("returns apps for allowed role", async () => {
    const now = new Date("2026-02-08T00:00:00.000Z");
    const rows = [{ appId: "app1", createdAt: now }];
    const db = createDbMock(new Map([[apps, rows]]));

    const caller = appRouter.createCaller({ role: "SUPER_ADMIN", db } as any);
    const result = await caller.list();

    expect(result).toEqual(rows);
  });

  it("rejects forbidden role", async () => {
    const db = createDbMock(new Map([[apps, []]]));
    const caller = appRouter.createCaller({ role: "USER", db } as any);

    await expect(caller.list()).rejects.toBeInstanceOf(TRPCError);
  });
});
