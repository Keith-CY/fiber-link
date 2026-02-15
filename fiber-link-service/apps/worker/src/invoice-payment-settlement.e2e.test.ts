import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInMemoryLedgerRepo,
  createInMemoryTipIntentRepo,
  type InvoiceState,
  type LedgerRepo,
} from "@fiber-link/db";
import { handleTipCreate } from "../../rpc/src/methods/tip";
import { runSettlementDiscovery } from "./settlement-discovery";

type CreateInvoiceInput = { amount: string; asset: "CKB" | "USDI" };

const adapterState = {
  nextInvoice: 1,
  createInvoiceCalls: [] as CreateInvoiceInput[],
  invoiceStatus: new Map<string, InvoiceState>(),
  createInvoiceError: null as Error | null,
};

vi.mock("@fiber-link/fiber-adapter", () => {
  return {
    createAdapter() {
      return {
        async createInvoice(input: CreateInvoiceInput) {
          adapterState.createInvoiceCalls.push(input);
          if (adapterState.createInvoiceError) {
            throw adapterState.createInvoiceError;
          }

          const invoice = `inv-e2e-${adapterState.nextInvoice++}`;
          adapterState.invoiceStatus.set(invoice, "UNPAID");
          return { invoice };
        },
      };
    },
  };
});

const tipIntentRepo = createInMemoryTipIntentRepo();
const ledgerRepo = createInMemoryLedgerRepo();

function createSettlementAdapter() {
  return {
    async getInvoiceStatus({ invoice }: { invoice: string }) {
      return { state: adapterState.invoiceStatus.get(invoice) ?? "UNPAID" };
    },
  };
}

function resetAdapterState() {
  adapterState.nextInvoice = 1;
  adapterState.createInvoiceCalls = [];
  adapterState.invoiceStatus.clear();
  adapterState.createInvoiceError = null;
}

describe("invoice -> payment -> settlement e2e", () => {
  beforeEach(() => {
    process.env.FIBER_RPC_URL = "http://fiber-rpc.test";
    tipIntentRepo.__resetForTests?.();
    ledgerRepo.__resetForTests?.();
    resetAdapterState();
  });

  it("covers happy path from invoice creation to settled accounting update", async () => {
    const createResult = await handleTipCreate(
      {
        appId: "app-e2e",
        postId: "post-1",
        fromUserId: "tipper-1",
        toUserId: "creator-1",
        asset: "USDI",
        amount: "10",
      },
      { tipIntentRepo },
    );

    expect(createResult).toEqual({ invoice: "inv-e2e-1" });
    expect(adapterState.createInvoiceCalls).toEqual([{ amount: "10", asset: "USDI" }]);

    adapterState.invoiceStatus.set(createResult.invoice, "SETTLED");
    const summary = await runSettlementDiscovery({
      limit: 10,
      adapter: createSettlementAdapter(),
      tipIntentRepo,
      ledgerRepo,
    });

    expect(summary).toMatchObject({
      scanned: 1,
      settledCredits: 1,
      settledDuplicates: 0,
      failed: 0,
      stillUnpaid: 0,
      errors: 0,
    });

    const saved = await tipIntentRepo.findByInvoiceOrThrow(createResult.invoice);
    expect(saved.invoiceState).toBe("SETTLED");

    const entries = ledgerRepo.__listForTests?.() ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0]?.type).toBe("credit");
    expect(entries[0]?.appId).toBe("app-e2e");
    expect(entries[0]?.userId).toBe("creator-1");
    expect(entries[0]?.asset).toBe("USDI");
    expect(entries[0]?.amount).toBe("10");
    expect(entries[0]?.idempotencyKey).toBe(`settlement:tip_intent:${saved.id}`);
  });

  it("marks tip as FAILED when payment status is FAILED and keeps accounting unchanged", async () => {
    const createResult = await handleTipCreate(
      {
        appId: "app-e2e",
        postId: "post-2",
        fromUserId: "tipper-2",
        toUserId: "creator-2",
        asset: "USDI",
        amount: "5",
      },
      { tipIntentRepo },
    );

    expect(createResult.invoice).toBe("inv-e2e-1");

    adapterState.invoiceStatus.set(createResult.invoice, "FAILED");
    const summary = await runSettlementDiscovery({
      limit: 10,
      adapter: createSettlementAdapter(),
      tipIntentRepo,
      ledgerRepo,
    });

    expect(summary).toMatchObject({
      scanned: 1,
      settledCredits: 0,
      settledDuplicates: 0,
      failed: 1,
      stillUnpaid: 0,
      errors: 0,
    });

    const saved = await tipIntentRepo.findByInvoiceOrThrow(createResult.invoice);
    expect(saved.invoiceState).toBe("FAILED");
    expect(ledgerRepo.__listForTests?.()).toHaveLength(0);
  });

  it("keeps state recoverable when settlement write mismatches once and succeeds on retry", async () => {
    const createResult = await handleTipCreate(
      {
        appId: "app-e2e",
        postId: "post-3",
        fromUserId: "tipper-3",
        toUserId: "creator-3",
        asset: "USDI",
        amount: "7",
      },
      { tipIntentRepo },
    );

    adapterState.invoiceStatus.set(createResult.invoice, "SETTLED");

    let failCreditOnce = true;
    const flakyLedgerRepo: LedgerRepo = {
      ...ledgerRepo,
      async creditOnce(input) {
        if (failCreditOnce) {
          failCreditOnce = false;
          throw new Error("mocked settlement mismatch");
        }
        return ledgerRepo.creditOnce(input);
      },
      async debitOnce(input) {
        return ledgerRepo.debitOnce(input);
      },
      async getBalance(input) {
        return ledgerRepo.getBalance(input);
      },
      __listForTests: ledgerRepo.__listForTests,
      __resetForTests: ledgerRepo.__resetForTests,
    };

    const first = await runSettlementDiscovery({
      limit: 10,
      adapter: createSettlementAdapter(),
      tipIntentRepo,
      ledgerRepo: flakyLedgerRepo,
    });

    expect(first).toMatchObject({
      scanned: 1,
      settledCredits: 0,
      settledDuplicates: 0,
      failed: 0,
      stillUnpaid: 0,
      errors: 1,
    });

    const afterFirst = await tipIntentRepo.findByInvoiceOrThrow(createResult.invoice);
    expect(afterFirst.invoiceState).toBe("UNPAID");
    expect(ledgerRepo.__listForTests?.()).toHaveLength(0);

    const second = await runSettlementDiscovery({
      limit: 10,
      adapter: createSettlementAdapter(),
      tipIntentRepo,
      ledgerRepo: flakyLedgerRepo,
    });

    expect(second).toMatchObject({
      scanned: 1,
      settledCredits: 1,
      settledDuplicates: 0,
      failed: 0,
      stillUnpaid: 0,
      errors: 0,
    });

    const afterSecond = await tipIntentRepo.findByInvoiceOrThrow(createResult.invoice);
    expect(afterSecond.invoiceState).toBe("SETTLED");
    expect(ledgerRepo.__listForTests?.()).toHaveLength(1);
  });
});
