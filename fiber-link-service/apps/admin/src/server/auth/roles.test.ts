import { describe, it, expect } from "vitest";
import { requireRole } from "./roles";

describe("roles", () => {
  it("throws when role missing", () => {
    expect(() => requireRole("SUPER_ADMIN", "COMMUNITY_ADMIN")).toThrow();
  });
});
