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
});
