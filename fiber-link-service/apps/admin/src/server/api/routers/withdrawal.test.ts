import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { withdrawals } from "@fiber-link/db";
import { withdrawalRouter } from "./withdrawal";

function createDbMock(tableRows: Map<unknown, unknown[]>) {
  return {
    select: () => ({
      from: (table: unknown) => Promise.resolve(tableRows.get(table) ?? []),
    }),
  };
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
    const db = createDbMock(new Map([[withdrawals, rows]]));

    const caller = withdrawalRouter.createCaller({ role: "SUPER_ADMIN", db } as any);
    const result = await caller.list();

    expect(result).toEqual(rows);
  });

  it("rejects forbidden role", async () => {
    const db = createDbMock(new Map([[withdrawals, []]]));
    const caller = withdrawalRouter.createCaller({ role: "USER", db } as any);

    await expect(caller.list()).rejects.toBeInstanceOf(TRPCError);
  });
});

