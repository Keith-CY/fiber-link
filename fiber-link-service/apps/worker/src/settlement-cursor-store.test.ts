import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryWorkerStateRepo } from "@fiber-link/db";
import { describe, expect, it } from "vitest";
import { createDbSettlementCursorStore, createFileSettlementCursorStore } from "./settlement-cursor-store";

describe("createFileSettlementCursorStore", () => {
  async function expectInvalidBackupPreservesPayload(root: string, originalPayload: string) {
    const files = await readdir(root);
    const backupName = files.find((name) => name.startsWith("cursor.json.invalid-"));
    expect(backupName).toBeDefined();
    const backupContent = await readFile(join(root, backupName as string), "utf8");
    expect(backupContent).toBe(originalPayload);
  }

  it("loads undefined when cursor file does not exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "fiber-link-cursor-"));
    const filePath = join(root, "cursor.json");
    const store = createFileSettlementCursorStore(filePath);

    await expect(store.load()).resolves.toBeUndefined();
  });

  it("persists and restores cursor values", async () => {
    const root = await mkdtemp(join(tmpdir(), "fiber-link-cursor-"));
    const filePath = join(root, "cursor.json");
    const store = createFileSettlementCursorStore(filePath);
    const createdAt = new Date("2026-02-15T00:00:00.000Z");

    await store.save({ id: "tip-123", createdAt });
    const loaded = await store.load();

    expect(loaded).toEqual({
      id: "tip-123",
      createdAt,
    });
  });

  it("clears persisted cursor when saving undefined", async () => {
    const root = await mkdtemp(join(tmpdir(), "fiber-link-cursor-"));
    const filePath = join(root, "cursor.json");
    const store = createFileSettlementCursorStore(filePath);

    await store.save({ id: "tip-123", createdAt: new Date("2026-02-15T00:00:00.000Z") });
    await store.save(undefined);

    await expect(store.load()).resolves.toBeUndefined();
  });

  it("recovers malformed cursor payload and continues startup", async () => {
    const root = await mkdtemp(join(tmpdir(), "fiber-link-cursor-"));
    const filePath = join(root, "cursor.json");
    const malformedPayload = "{not-json";
    await writeFile(filePath, malformedPayload, "utf8");

    const store = createFileSettlementCursorStore(filePath);
    await expect(store.load()).resolves.toBeUndefined();

    await expectInvalidBackupPreservesPayload(root, malformedPayload);
  });

  it("recovers partial cursor payload and continues startup", async () => {
    const root = await mkdtemp(join(tmpdir(), "fiber-link-cursor-"));
    const filePath = join(root, "cursor.json");
    const partialPayload = '{"id":"tip-123"}';
    await writeFile(filePath, partialPayload, "utf8");

    const store = createFileSettlementCursorStore(filePath);
    await expect(store.load()).resolves.toBeUndefined();

    await expectInvalidBackupPreservesPayload(root, partialPayload);
  });

  it("writes cursor payload with stable fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "fiber-link-cursor-"));
    const filePath = join(root, "cursor.json");
    const store = createFileSettlementCursorStore(filePath);

    await store.save({ id: "tip-xyz", createdAt: new Date("2026-02-16T00:00:00.000Z") });
    const content = await readFile(filePath, "utf8");

    expect(content).toContain('"id": "tip-xyz"');
    expect(content).toContain('"createdAt": "2026-02-16T00:00:00.000Z"');
    expect(content).toContain('"updatedAt"');
  });
});

describe("createDbSettlementCursorStore", () => {
  const CURSOR = { id: "tip-42", createdAt: new Date("2026-02-16T00:00:00.000Z") };

  it("round-trips a cursor through the worker state repo", async () => {
    const repo = createInMemoryWorkerStateRepo();
    const store = createDbSettlementCursorStore(repo);

    expect(await store.load()).toBeUndefined();

    await store.save(CURSOR);
    expect(await store.load()).toEqual(CURSOR);

    await store.save(undefined);
    expect(await store.load()).toBeUndefined();
  });

  it("treats an unparsable stored value as no cursor", async () => {
    const repo = createInMemoryWorkerStateRepo({ "settlement-cursor": { id: "", createdAt: "not-a-date" } });
    const store = createDbSettlementCursorStore(repo);
    expect(await store.load()).toBeUndefined();
  });

  it("adopts the legacy file cursor once when the database is empty", async () => {
    const repo = createInMemoryWorkerStateRepo();
    let fileLoads = 0;
    const legacyFileStore = {
      load: async () => {
        fileLoads += 1;
        return CURSOR;
      },
      save: async () => {},
    };
    const store = createDbSettlementCursorStore(repo, { legacyFileStore });

    expect(await store.load()).toEqual(CURSOR);
    expect(fileLoads).toBe(1);

    // Second load is served from the database, not the file.
    expect(await store.load()).toEqual(CURSOR);
    expect(fileLoads).toBe(1);
  });

  it("prefers the database value over the legacy file", async () => {
    const repo = createInMemoryWorkerStateRepo({
      "settlement-cursor": { id: "tip-db", createdAt: "2026-02-17T00:00:00.000Z" },
    });
    const legacyFileStore = {
      load: async () => CURSOR,
      save: async () => {},
    };
    const store = createDbSettlementCursorStore(repo, { legacyFileStore });
    expect(await store.load()).toEqual({ id: "tip-db", createdAt: new Date("2026-02-17T00:00:00.000Z") });
  });

  it("ignores legacy file read errors during adoption", async () => {
    const repo = createInMemoryWorkerStateRepo();
    const legacyFileStore = {
      load: async () => {
        throw new Error("volume unavailable");
      },
      save: async () => {},
    };
    const store = createDbSettlementCursorStore(repo, { legacyFileStore });
    expect(await store.load()).toBeUndefined();
  });
});
