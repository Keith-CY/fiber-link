import { describe, it, expect } from "vitest";
import { runWithdrawalBatch } from "./withdrawal-batch";

it("runs batch", async () => {
  const res = await runWithdrawalBatch();
  expect(res.processed).toBe(0);
});
