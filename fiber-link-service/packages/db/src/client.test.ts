import { describe, expect, it } from "vitest";
import { createDbClient } from "./client";

describe("createDbClient", () => {
  it("creates a db client when DATABASE_URL is present", () => {
    const db = createDbClient("postgres://postgres:postgres@127.0.0.1:5432/fiber_link");

    expect(db).toBeDefined();
  });

  it("throws a clear error when DATABASE_URL is missing", () => {
    expect(() => createDbClient("")).toThrow("DATABASE_URL is required");
  });

  it("accepts options object with explicit pool settings", () => {
    const db = createDbClient({
      url: "postgres://postgres:postgres@127.0.0.1:5432/fiber_link",
      maxConnections: 5,
      idleTimeoutMs: 10_000,
      connectionTimeoutMs: 3_000,
      statementTimeoutMs: 15_000,
    });
    expect(db).toBeDefined();
  });

  it("accepts options object and falls back to DATABASE_URL env var when url is omitted", () => {
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:5432/fiber_link";
    try {
      const db = createDbClient({ maxConnections: 3 });
      expect(db).toBeDefined();
    } finally {
      if (original === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = original;
      }
    }
  });

  it("throws when options object omits url and DATABASE_URL env is missing", () => {
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(() => createDbClient({})).toThrow("DATABASE_URL is required");
    } finally {
      if (original !== undefined) process.env.DATABASE_URL = original;
    }
  });
});
