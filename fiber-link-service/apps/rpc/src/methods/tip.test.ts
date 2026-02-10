import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleTipCreate } from "./tip";
import { createInMemoryTipIntentRepo } from "@fiber-link/db";

vi.mock("@fiber-link/fiber-adapter", () => {
  return {
    createAdapter() {
      return {
        async createInvoice() {
          return { invoice: "inv-tip-1" };
        },
      };
    },
  };
});

const tipIntentRepo = createInMemoryTipIntentRepo();

beforeEach(() => {
  process.env.FIBER_RPC_URL = "http://localhost:8119";
  tipIntentRepo.__resetForTests?.();
});

it("creates a tip intent with invoice", async () => {
  const res = await handleTipCreate({
    appId: "app1",
    postId: "p1",
    fromUserId: "u1",
    toUserId: "u2",
    asset: "USDI",
    amount: "10",
  }, { tipIntentRepo });

  expect(res.invoice).toBe("inv-tip-1");
  const saved = await tipIntentRepo.findByInvoiceOrThrow("inv-tip-1");
  expect(saved.invoiceState).toBe("UNPAID");
  expect(saved.postId).toBe("p1");
});
