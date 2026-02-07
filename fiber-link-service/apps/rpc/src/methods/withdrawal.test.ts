import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryWithdrawalRepo } from "@fiber-link/db";
import { requestWithdrawal } from "./withdrawal";

describe("requestWithdrawal", () => {
  const repo = createInMemoryWithdrawalRepo();

  beforeEach(() => {
    repo.__resetForTests();
  });

  it("creates PENDING withdrawal request", async () => {
    const res = await requestWithdrawal({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "10",
      toAddress: "ckt1q...",
    }, { repo });

    expect(res.state).toBe("PENDING");
    const saved = await repo.findByIdOrThrow(res.id);
    expect(saved.state).toBe("PENDING");
    expect(saved.retryCount).toBe(0);
    expect(saved.nextRetryAt).toBeNull();
  });
});
