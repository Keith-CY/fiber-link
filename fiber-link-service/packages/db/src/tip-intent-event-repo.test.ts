import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "./client";
import { createDbTipIntentEventRepo, createInMemoryTipIntentEventRepo } from "./tip-intent-event-repo";

function createRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    tipIntentId: "tip-1",
    invoice: "inv-1",
    source: "TIP_STATUS",
    type: "TIP_STATUS_UNPAID_OBSERVED",
    previousInvoiceState: "UNPAID",
    nextInvoiceState: "UNPAID",
    metadata: {
      observedState: "UNPAID",
    },
    createdAt: new Date("2026-02-21T00:00:00.000Z"),
    ...overrides,
  };
}

describe("tipIntentEventRepo (db)", () => {
  it("appends and lists timeline events for a tip intent", async () => {
    const insertReturning = vi.fn(async () => [createRow({ type: "TIP_CREATED", source: "TIP_CREATE" })]);
    const insertValues = vi.fn(() => ({ returning: insertReturning }));
    const insert = vi.fn(() => ({ values: insertValues }));

    const selectLimit = vi.fn(async () => [createRow()]);
    const selectOrderBy = vi.fn(() => ({ limit: selectLimit }));
    const selectWhere = vi.fn(() => ({ orderBy: selectOrderBy }));
    const selectFrom = vi.fn(() => ({ where: selectWhere }));
    const select = vi.fn(() => ({ from: selectFrom }));

    const db = { insert, select } as unknown as DbClient;
    const repo = createDbTipIntentEventRepo(db);

    const appended = await repo.append({
      tipIntentId: "tip-1",
      invoice: "inv-1",
      source: "TIP_CREATE",
      type: "TIP_CREATED",
      previousInvoiceState: null,
      nextInvoiceState: "UNPAID",
      metadata: { phase: "create" },
      createdAt: new Date("2026-02-21T00:00:00.000Z"),
    });

    expect(appended.type).toBe("TIP_CREATED");
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        tipIntentId: "tip-1",
        source: "TIP_CREATE",
        type: "TIP_CREATED",
      }),
    );

    const listed = await repo.listByTipIntentId("tip-1", { limit: 10 });
    expect(selectLimit).toHaveBeenCalledWith(10);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      tipIntentId: "tip-1",
      type: "TIP_STATUS_UNPAID_OBSERVED",
      metadata: { observedState: "UNPAID" },
    });
  });
});

describe("tipIntentEventRepo (in-memory)", () => {
  const repo = createInMemoryTipIntentEventRepo();

  beforeEach(() => {
    repo.__resetForTests?.();
  });

  it("stores append-only events ordered by createdAt", async () => {
    await repo.append({
      tipIntentId: "tip-1",
      invoice: "inv-1",
      source: "TIP_CREATE",
      type: "TIP_CREATED",
      previousInvoiceState: null,
      nextInvoiceState: "UNPAID",
      metadata: { position: "first" },
      createdAt: new Date("2026-02-21T00:00:00.000Z"),
    });
    await repo.append({
      tipIntentId: "tip-1",
      invoice: "inv-1",
      source: "TIP_STATUS",
      type: "TIP_STATUS_SETTLED",
      previousInvoiceState: "UNPAID",
      nextInvoiceState: "SETTLED",
      metadata: { position: "second" },
      createdAt: new Date("2026-02-21T00:00:01.000Z"),
    });

    const listed = await repo.listByTipIntentId("tip-1");
    expect(listed.map((event) => event.type)).toEqual(["TIP_CREATED", "TIP_STATUS_SETTLED"]);
  });

  it("returns cloned metadata so tests cannot mutate stored events", async () => {
    await repo.append({
      tipIntentId: "tip-1",
      invoice: "inv-1",
      source: "TIP_STATUS",
      type: "TIP_STATUS_UNPAID_OBSERVED",
      previousInvoiceState: "UNPAID",
      nextInvoiceState: "UNPAID",
      metadata: { observedState: "UNPAID" },
    });

    const listed = await repo.listByTipIntentId("tip-1");
    (listed[0]?.metadata as Record<string, unknown>).observedState = "MUTATED";

    const listedAgain = await repo.listByTipIntentId("tip-1");
    expect((listedAgain[0]?.metadata as Record<string, unknown>).observedState).toBe("UNPAID");
  });
});
