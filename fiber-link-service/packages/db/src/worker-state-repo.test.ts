import { describe, expect, it, vi } from "vitest";
import type { DbClient } from "./client";
import { createDbWorkerStateRepo, createInMemoryWorkerStateRepo } from "./worker-state-repo";

describe("createInMemoryWorkerStateRepo", () => {
  it("round-trips values by key", async () => {
    const repo = createInMemoryWorkerStateRepo();
    expect(await repo.get("cursor")).toBeUndefined();

    await repo.set("cursor", { id: "tip-1" });
    expect(await repo.get("cursor")).toEqual({ id: "tip-1" });

    await repo.set("cursor", { id: "tip-2" });
    expect(await repo.get("cursor")).toEqual({ id: "tip-2" });

    await repo.delete("cursor");
    expect(await repo.get("cursor")).toBeUndefined();
  });

  it("keeps keys independent", async () => {
    const repo = createInMemoryWorkerStateRepo({ a: { n: 1 } });
    await repo.set("b", { n: 2 });
    expect(await repo.get("a")).toEqual({ n: 1 });
    expect(await repo.get("b")).toEqual({ n: 2 });
    await repo.delete("a");
    expect(await repo.get("b")).toEqual({ n: 2 });
  });
});

describe("createDbWorkerStateRepo", () => {
  function createDbMock(rows: Array<{ value: Record<string, unknown> }> = []) {
    const selectLimit = vi.fn(async (..._args: unknown[]) => rows);
    const selectWhere = vi.fn((..._args: unknown[]) => ({ limit: selectLimit }));
    const selectFrom = vi.fn((..._args: unknown[]) => ({ where: selectWhere }));
    const select = vi.fn(() => ({ from: selectFrom }));

    const insertOnConflict = vi.fn(async (..._args: unknown[]) => undefined);
    const insertValues = vi.fn((..._args: unknown[]) => ({ onConflictDoUpdate: insertOnConflict }));
    const insert = vi.fn(() => ({ values: insertValues }));

    const deleteWhere = vi.fn(async (..._args: unknown[]) => undefined);
    const del = vi.fn(() => ({ where: deleteWhere }));

    const db = { select, insert, delete: del } as unknown as DbClient;
    return { db, selectLimit, insertValues, insertOnConflict, deleteWhere };
  }

  it("returns the stored value for a key", async () => {
    const mock = createDbMock([{ value: { id: "tip-9" } }]);
    const repo = createDbWorkerStateRepo(mock.db);
    expect(await repo.get("settlement-cursor")).toEqual({ id: "tip-9" });
  });

  it("returns undefined when no row exists", async () => {
    const mock = createDbMock([]);
    const repo = createDbWorkerStateRepo(mock.db);
    expect(await repo.get("settlement-cursor")).toBeUndefined();
  });

  it("upserts on set", async () => {
    const mock = createDbMock();
    const repo = createDbWorkerStateRepo(mock.db);
    await repo.set("settlement-cursor", { id: "tip-1" });

    const valuesArg = mock.insertValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(valuesArg.key).toBe("settlement-cursor");
    expect(valuesArg.value).toEqual({ id: "tip-1" });
    expect(mock.insertOnConflict).toHaveBeenCalledTimes(1);
  });

  it("deletes by key", async () => {
    const mock = createDbMock();
    const repo = createDbWorkerStateRepo(mock.db);
    await repo.delete("settlement-cursor");
    expect(mock.deleteWhere).toHaveBeenCalledTimes(1);
  });
});
