import { describe, expect, it } from "vitest";
import { toProductError } from "./productized-errors";

describe("productized errors", () => {
  it("maps known error codes to guided actions", () => {
    const e = toProductError("ERR_CONFIG_INVALID", "missing DATABASE_URL");
    expect(e.id).toBe("ERR_CONFIG_INVALID");
    expect(e.summary).toContain("invalid");
    expect(e.nextActions.length).toBeGreaterThan(1);
  });

  it("provides safe fallback for unknown errors", () => {
    const e = toProductError("ERR_SOMETHING_NEW", "stack trace id=abc");
    expect(e.id).toBe("ERR_UNKNOWN");
    expect(e.summary).toContain("unexpected");
    expect(e.nextActions).toContain("Open diagnostics");
  });
});
