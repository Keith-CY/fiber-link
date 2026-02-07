import { beforeEach, describe, expect, it } from "vitest";
import { __resetWithdrawalStoreForTests, getWithdrawalByIdOrThrow, requestWithdrawal } from "./withdrawal";

describe("requestWithdrawal", () => {
  beforeEach(() => {
    __resetWithdrawalStoreForTests();
  });

  it("creates PENDING withdrawal request", async () => {
    const res = await requestWithdrawal({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "10",
      toAddress: "ckt1q...",
    });

    expect(res.state).toBe("PENDING");
    const saved = await getWithdrawalByIdOrThrow(res.id);
    expect(saved.state).toBe("PENDING");
    expect(saved.retryCount).toBe(0);
    expect(saved.nextRetryAt).toBeNull();
  });
});
