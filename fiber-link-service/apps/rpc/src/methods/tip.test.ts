import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleTipCreate, handleTipStatus } from "./tip";
import { createInMemoryTipIntentRepo } from "@fiber-link/db";

let invoiceStatusByInvoice: Record<string, "UNPAID" | "SETTLED" | "FAILED"> = {};

vi.mock("@fiber-link/fiber-adapter", () => {
  return {
    createAdapter() {
      return {
        async createInvoice() {
          return { invoice: "inv-tip-1" };
        },
        async getInvoiceStatus({ invoice }: { invoice: string }) {
          return { state: invoiceStatusByInvoice[invoice] ?? "UNPAID" };
        },
      };
    },
  };
});

const tipIntentRepo = createInMemoryTipIntentRepo();

beforeEach(() => {
  process.env.FIBER_RPC_URL = "http://localhost:8119";
  tipIntentRepo.__resetForTests?.();
  invoiceStatusByInvoice = {};
});

describe("tip methods", () => {
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

  it("returns UNPAID when upstream invoice is still unpaid", async () => {
    const res = await handleTipCreate({
      appId: "app1",
      postId: "p1",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
    }, { tipIntentRepo });

    const status = await handleTipStatus({ invoice: res.invoice }, { tipIntentRepo });
    expect(status).toEqual({ state: "UNPAID" });
  });

  it("updates and returns SETTLED when upstream invoice is settled", async () => {
    const res = await handleTipCreate({
      appId: "app1",
      postId: "p1",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
    }, { tipIntentRepo });
    invoiceStatusByInvoice[res.invoice] = "SETTLED";

    const status = await handleTipStatus({ invoice: res.invoice }, { tipIntentRepo });
    const saved = await tipIntentRepo.findByInvoiceOrThrow(res.invoice);

    expect(status).toEqual({ state: "SETTLED" });
    expect(saved.invoiceState).toBe("SETTLED");
  });

  it("updates and returns FAILED when upstream invoice is failed", async () => {
    const res = await handleTipCreate({
      appId: "app1",
      postId: "p1",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
    }, { tipIntentRepo });
    invoiceStatusByInvoice[res.invoice] = "FAILED";

    const status = await handleTipStatus({ invoice: res.invoice }, { tipIntentRepo });
    const saved = await tipIntentRepo.findByInvoiceOrThrow(res.invoice);

    expect(status).toEqual({ state: "FAILED" });
    expect(saved.invoiceState).toBe("FAILED");
  });

  it("throws when invoice does not exist", async () => {
    await expect(handleTipStatus({ invoice: "missing-invoice" }, { tipIntentRepo })).rejects.toThrow(
      "tip intent not found",
    );
  });
});
