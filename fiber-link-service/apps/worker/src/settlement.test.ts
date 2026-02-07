import { describe, it, expect } from "vitest";
import { markSettled } from "./settlement";

it("marks invoice settled and credits ledger", async () => {
  const res = await markSettled({ invoice: "fiber:USDI:10:stub" });
  expect(res.credited).toBe(true);
});
