import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createFileSettlementCursorStore } from "./settlement-cursor-store";

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
