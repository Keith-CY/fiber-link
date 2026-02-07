import { describe, it, expect } from "vitest";
import { tipIntents, ledgerEntries } from "./schema";

describe("schema", () => {
  it("exports core tables", () => {
    expect(tipIntents).toBeDefined();
    expect(ledgerEntries).toBeDefined();
  });
});
