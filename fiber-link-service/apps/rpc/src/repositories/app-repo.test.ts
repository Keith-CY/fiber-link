import { describe, expect, it, vi } from "vitest";
import { createDbAppRepo, createInMemoryAppRepo } from "./app-repo";

describe("appRepo", () => {
  it("finds app by appId", async () => {
    const repo = createInMemoryAppRepo([{ appId: "app1", hmacSecret: "s1" }]);

    const found = await repo.findByAppId("app1");

    expect(found?.hmacSecret).toBe("s1");
  });

  it("upserts app secret", async () => {
    const repo = createInMemoryAppRepo([]);

    await repo.upsert({ appId: "app1", hmacSecret: "s1" });
    await repo.upsert({ appId: "app1", hmacSecret: "s2" });

    const found = await repo.findByAppId("app1");
    expect(found?.hmacSecret).toBe("s2");
  });

  it("createDbAppRepo.findByAppId returns null when row does not exist", async () => {
    const selectLimit = vi.fn(async () => []);
    const selectWhere = vi.fn(() => ({ limit: selectLimit }));
    const selectFrom = vi.fn(() => ({ where: selectWhere }));
    const db = {
      select: vi.fn(() => ({ from: selectFrom })),
    };

    const repo = createDbAppRepo(db as never);
    const found = await repo.findByAppId("missing-app");

    expect(found).toBeNull();
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(selectLimit).toHaveBeenCalledWith(1);
  });

  it("createDbAppRepo reads and upserts through db client", async () => {
    const selectLimit = vi.fn(async () => [{ appId: "app1", hmacSecret: "s1" }]);
    const selectWhere = vi.fn(() => ({ limit: selectLimit }));
    const selectFrom = vi.fn(() => ({ where: selectWhere }));

    const returning = vi.fn(async () => [{ appId: "app1", hmacSecret: "s2" }]);
    const onConflictDoUpdate = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));

    const db = {
      select: vi.fn(() => ({ from: selectFrom })),
      insert,
    };

    const repo = createDbAppRepo(db as never);

    const found = await repo.findByAppId("app1");
    expect(found).toEqual({ appId: "app1", hmacSecret: "s1" });

    const saved = await repo.upsert({ appId: "app1", hmacSecret: "s2" });
    expect(saved).toEqual({ appId: "app1", hmacSecret: "s2" });
    expect(values).toHaveBeenCalledWith({ appId: "app1", hmacSecret: "s2" });
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
    expect(returning).toHaveBeenCalledTimes(1);
  });
});
