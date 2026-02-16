import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createFileSettlementCursorStore } from "./settlement-cursor-store";

describe("createFileSettlementCursorStore", () => {
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

  it("throws for malformed cursor payload", async () => {
    const root = await mkdtemp(join(tmpdir(), "fiber-link-cursor-"));
    const filePath = join(root, "cursor.json");
    await writeFile(filePath, "{not-json", "utf8");

    const store = createFileSettlementCursorStore(filePath);
    await expect(store.load()).rejects.toThrow("Invalid settlement cursor file");
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
