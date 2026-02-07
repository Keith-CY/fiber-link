import { describe, it, expect } from "vitest";
import { requestWithdrawal } from "./withdrawal";

it("creates withdrawal request", async () => {
  const res = await requestWithdrawal({
    appId: "app1",
    userId: "u1",
    asset: "USDI",
    amount: "10",
    toAddress: "ckt1q...",
  });
  expect(res.state).toBe("PENDING");
});
