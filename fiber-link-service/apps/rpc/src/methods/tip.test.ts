import { beforeEach, expect, it } from "vitest";
import { handleTipCreate, handleTipStatus } from "./tip";
import {
  InvoiceStateTransitionError,
  createInMemoryLedgerRepo,
  createInMemoryTipIntentRepo,
  type LedgerWriteInput,
} from "@fiber-link/db";

let invoiceStatusByInvoice: Record<string, "UNPAID" | "SETTLED" | "FAILED"> = {};

const tipIntentRepo = createInMemoryTipIntentRepo();
const ledgerRepo = createInMemoryLedgerRepo();
const adapter = {
  async createInvoice() {
    return { invoice: "inv-tip-1" };
  },
  async getInvoiceStatus({ invoice }: { invoice: string }) {
    return { state: invoiceStatusByInvoice[invoice] ?? "UNPAID" };
  },
};

beforeEach(() => {
  process.env.FIBER_RPC_URL = "http://localhost:8119";
  tipIntentRepo.__resetForTests?.();
  ledgerRepo.__resetForTests?.();
  invoiceStatusByInvoice = {};
});

it("creates a tip intent with invoice", async () => {
  const res = await handleTipCreate({
    appId: "app1",
    postId: "p1",
    fromUserId: "u1",
    toUserId: "u2",
    asset: "USDI",
    amount: "10",
  }, { tipIntentRepo, adapter });

  expect(res.invoice).toBe("inv-tip-1");
  const saved = await tipIntentRepo.findByInvoiceOrThrow("inv-tip-1");
  expect(saved.invoiceState).toBe("UNPAID");
  expect(saved.postId).toBe("p1");
});

it("returns current tip status for UNPAID intent", async () => {
  const response = await handleTipCreate({
    appId: "app1",
    postId: "p1",
    fromUserId: "u1",
    toUserId: "u2",
    asset: "USDI",
    amount: "10",
  }, { tipIntentRepo, adapter });

  const status = await handleTipStatus({
    invoice: response.invoice,
  }, { tipIntentRepo, ledgerRepo, adapter });
  expect(status.state).toBe("UNPAID");
  expect(ledgerRepo.__listForTests?.()).toHaveLength(0);
});

it("marks intent as SETTLED when upstream invoice is settled", async () => {
  const response = await handleTipCreate({
    appId: "app1",
    postId: "p1",
    fromUserId: "u1",
    toUserId: "u2",
    asset: "USDI",
    amount: "10",
  }, { tipIntentRepo, adapter });
  invoiceStatusByInvoice[response.invoice] = "SETTLED";

  const status = await handleTipStatus({ invoice: response.invoice }, { tipIntentRepo, ledgerRepo, adapter });

  const saved = await tipIntentRepo.findByInvoiceOrThrow(response.invoice);
  expect(status.state).toBe("SETTLED");
  expect(saved.invoiceState).toBe("SETTLED");
  const ledgerEntries = ledgerRepo.__listForTests?.() ?? [];
  expect(ledgerEntries).toHaveLength(1);
  expect(ledgerEntries[0]?.idempotencyKey).toBe(`settlement:tip_intent:${saved.id}`);
});

it("marks intent as FAILED when upstream invoice is failed", async () => {
  const response = await handleTipCreate({
    appId: "app1",
    postId: "p1",
    fromUserId: "u1",
    toUserId: "u2",
    asset: "USDI",
    amount: "10",
  }, { tipIntentRepo, adapter });
  invoiceStatusByInvoice[response.invoice] = "FAILED";

  const status = await handleTipStatus({ invoice: response.invoice }, { tipIntentRepo, ledgerRepo, adapter });

  const saved = await tipIntentRepo.findByInvoiceOrThrow(response.invoice);
  expect(status.state).toBe("FAILED");
  expect(saved.invoiceState).toBe("FAILED");
  expect(ledgerRepo.__listForTests?.()).toHaveLength(0);
});

it("keeps FAILED state bounded when upstream later reports SETTLED", async () => {
  const response = await handleTipCreate({
    appId: "app1",
    postId: "p1",
    fromUserId: "u1",
    toUserId: "u2",
    asset: "USDI",
    amount: "10",
  }, { tipIntentRepo, adapter });
  invoiceStatusByInvoice[response.invoice] = "FAILED";

  const failed = await handleTipStatus({ invoice: response.invoice }, { tipIntentRepo, ledgerRepo, adapter });
  expect(failed.state).toBe("FAILED");
  expect(ledgerRepo.__listForTests?.()).toHaveLength(0);

  invoiceStatusByInvoice[response.invoice] = "SETTLED";
  const bounded = await handleTipStatus({ invoice: response.invoice }, { tipIntentRepo, ledgerRepo, adapter });

  const saved = await tipIntentRepo.findByInvoiceOrThrow(response.invoice);
  expect(bounded.state).toBe("FAILED");
  expect(saved.invoiceState).toBe("FAILED");
  expect(ledgerRepo.__listForTests?.()).toHaveLength(0);
});

it("supports retry-safe settlement after transient ledger credit failure", async () => {
  const response = await handleTipCreate({
    appId: "app1",
    postId: "p1",
    fromUserId: "u1",
    toUserId: "u2",
    asset: "USDI",
    amount: "10",
  }, { tipIntentRepo, adapter });
  invoiceStatusByInvoice[response.invoice] = "SETTLED";

  const retryLedgerRepo = createInMemoryLedgerRepo();
  let failOnce = true;
  const flakyLedgerRepo = {
    ...retryLedgerRepo,
    async creditOnce(input: LedgerWriteInput) {
      if (failOnce) {
        failOnce = false;
        throw new Error("transient ledger credit failure");
      }
      return retryLedgerRepo.creditOnce(input);
    },
  };

  await expect(
    handleTipStatus({ invoice: response.invoice }, { tipIntentRepo, ledgerRepo: flakyLedgerRepo, adapter }),
  ).rejects.toThrow("transient ledger credit failure");

  const afterFailure = await tipIntentRepo.findByInvoiceOrThrow(response.invoice);
  expect(afterFailure.invoiceState).toBe("UNPAID");
  expect(retryLedgerRepo.__listForTests?.()).toHaveLength(0);

  const retried = await handleTipStatus(
    {
      invoice: response.invoice,
    },
    {
      tipIntentRepo,
      ledgerRepo: flakyLedgerRepo,
      adapter,
    },
  );
  expect(retried.state).toBe("SETTLED");

  const settled = await tipIntentRepo.findByInvoiceOrThrow(response.invoice);
  expect(settled.invoiceState).toBe("SETTLED");
  expect(retryLedgerRepo.__listForTests?.()).toHaveLength(1);
});

it("returns latest intent state when upstream transition becomes invalid after status read and stays retry-safe", async () => {
  const repository = createInMemoryTipIntentRepo();
  const response = await handleTipCreate(
    {
      appId: "app1",
      postId: "p1",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
    },
    { tipIntentRepo: repository, adapter },
  );
  invoiceStatusByInvoice[response.invoice] = "SETTLED";

  const conflictRepo = {
    ...repository,
    async updateInvoiceState(invoice: string, state: "UNPAID" | "SETTLED" | "FAILED") {
      const current = await repository.findByInvoiceOrThrow(invoice);
      await repository.updateInvoiceState(invoice, "FAILED");
      throw new InvoiceStateTransitionError(invoice, current.invoiceState, state);
    },
  };

  const status = await handleTipStatus(
    {
      invoice: response.invoice,
    },
    {
      tipIntentRepo: conflictRepo,
      ledgerRepo,
      adapter,
    },
  );

  expect(status.state).toBe("FAILED");
  expect(ledgerRepo.__listForTests?.()).toHaveLength(1);

  const retried = await handleTipStatus(
    {
      invoice: response.invoice,
    },
    {
      tipIntentRepo: conflictRepo,
      ledgerRepo,
      adapter,
    },
  );

  expect(retried.state).toBe("FAILED");
  expect(ledgerRepo.__listForTests?.()).toHaveLength(1);
});

it("fails status when invoice is unknown", async () => {
  await expect(handleTipStatus({ invoice: "missing-invoice" }, { tipIntentRepo, ledgerRepo, adapter })).rejects.toThrow(
    "tip intent not found",
  );
});
