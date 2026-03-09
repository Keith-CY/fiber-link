import { beforeEach, expect, it } from "vitest";
import { handleTipCreate, handleTipStatus } from "./tip";
import {
  createInMemoryLedgerRepo,
  createInMemoryTipIntentEventRepo,
  createInMemoryTipIntentRepo,
  type LedgerWriteInput,
} from "@fiber-link/db";

let invoiceStatusByInvoice: Record<string, "UNPAID" | "SETTLED" | "FAILED"> = {};

const tipIntentRepo = createInMemoryTipIntentRepo();
const ledgerRepo = createInMemoryLedgerRepo();
const tipIntentEventRepo = createInMemoryTipIntentEventRepo();
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
  tipIntentEventRepo.__resetForTests?.();
  invoiceStatusByInvoice = {};
});

it("creates a tip intent with invoice and optional message", async () => {
  const res = await handleTipCreate({
    appId: "app1",
    postId: "p1",
    fromUserId: "u1",
    toUserId: "u2",
    asset: "USDI",
    amount: "10",
    message: "Great post",
  }, { tipIntentRepo, tipIntentEventRepo, adapter });

  expect(res.invoice).toBe("inv-tip-1");
  const saved = await tipIntentRepo.findByInvoiceOrThrow("inv-tip-1");
  expect(saved.invoiceState).toBe("UNPAID");
  expect(saved.postId).toBe("p1");
  expect(saved.message).toBe("Great post");
  expect(tipIntentEventRepo.__listForTests?.()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        tipIntentId: saved.id,
        invoice: saved.invoice,
        source: "TIP_CREATE",
        type: "TIP_CREATED",
      }),
    ]),
  );
});

it("returns current tip status for UNPAID intent", async () => {
  const response = await handleTipCreate({
    appId: "app1",
    postId: "p1",
    fromUserId: "u1",
    toUserId: "u2",
    asset: "USDI",
    amount: "10",
  }, { tipIntentRepo, tipIntentEventRepo, adapter });

  const status = await handleTipStatus({
    invoice: response.invoice,
  }, { tipIntentRepo, ledgerRepo, tipIntentEventRepo, adapter });
  expect(status.state).toBe("UNPAID");
  expect(ledgerRepo.__listForTests?.()).toHaveLength(0);
  const tipIntent = await tipIntentRepo.findByInvoiceOrThrow(response.invoice);
  expect(tipIntentEventRepo.__listForTests?.()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ tipIntentId: tipIntent.id, type: "TIP_CREATED" }),
      expect.objectContaining({ tipIntentId: tipIntent.id, type: "TIP_STATUS_UNPAID_OBSERVED" }),
    ]),
  );
});

it("marks intent as SETTLED when upstream invoice is settled", async () => {
  const response = await handleTipCreate({
    appId: "app1",
    postId: "p1",
    fromUserId: "u1",
    toUserId: "u2",
    asset: "USDI",
    amount: "10",
  }, { tipIntentRepo, tipIntentEventRepo, adapter });
  invoiceStatusByInvoice[response.invoice] = "SETTLED";

  const status = await handleTipStatus({ invoice: response.invoice }, { tipIntentRepo, ledgerRepo, tipIntentEventRepo, adapter });

  const saved = await tipIntentRepo.findByInvoiceOrThrow(response.invoice);
  expect(status.state).toBe("SETTLED");
  expect(saved.invoiceState).toBe("SETTLED");
  const ledgerEntries = ledgerRepo.__listForTests?.() ?? [];
  expect(ledgerEntries).toHaveLength(1);
  expect(ledgerEntries[0]?.idempotencyKey).toBe(`settlement:tip_intent:${saved.id}`);
  expect(tipIntentEventRepo.__listForTests?.()).toEqual(
    expect.arrayContaining([expect.objectContaining({ tipIntentId: saved.id, type: "TIP_STATUS_SETTLED" })]),
  );
});

it("marks intent as FAILED when upstream invoice is failed", async () => {
  const response = await handleTipCreate({
    appId: "app1",
    postId: "p1",
    fromUserId: "u1",
    toUserId: "u2",
    asset: "USDI",
    amount: "10",
  }, { tipIntentRepo, tipIntentEventRepo, adapter });
  invoiceStatusByInvoice[response.invoice] = "FAILED";

  const status = await handleTipStatus({ invoice: response.invoice }, { tipIntentRepo, ledgerRepo, tipIntentEventRepo, adapter });

  const saved = await tipIntentRepo.findByInvoiceOrThrow(response.invoice);
  expect(status.state).toBe("FAILED");
  expect(saved.invoiceState).toBe("FAILED");
  expect(ledgerRepo.__listForTests?.()).toHaveLength(0);
  expect(tipIntentEventRepo.__listForTests?.()).toEqual(
    expect.arrayContaining([expect.objectContaining({ tipIntentId: saved.id, type: "TIP_STATUS_FAILED" })]),
  );
});

it("keeps FAILED state bounded when upstream later reports SETTLED", async () => {
  const response = await handleTipCreate({
    appId: "app1",
    postId: "p1",
    fromUserId: "u1",
    toUserId: "u2",
    asset: "USDI",
    amount: "10",
  }, { tipIntentRepo, tipIntentEventRepo, adapter });
  invoiceStatusByInvoice[response.invoice] = "FAILED";

  const failed = await handleTipStatus({ invoice: response.invoice }, { tipIntentRepo, ledgerRepo, tipIntentEventRepo, adapter });
  expect(failed.state).toBe("FAILED");
  expect(ledgerRepo.__listForTests?.()).toHaveLength(0);

  invoiceStatusByInvoice[response.invoice] = "SETTLED";
  const bounded = await handleTipStatus({ invoice: response.invoice }, { tipIntentRepo, ledgerRepo, tipIntentEventRepo, adapter });

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
  }, { tipIntentRepo, tipIntentEventRepo, adapter });
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
    handleTipStatus({ invoice: response.invoice }, { tipIntentRepo, ledgerRepo: flakyLedgerRepo, tipIntentEventRepo, adapter }),
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
      tipIntentEventRepo,
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
    { tipIntentRepo: repository, tipIntentEventRepo, adapter },
  );
  invoiceStatusByInvoice[response.invoice] = "SETTLED";

  const conflictRepo = {
    ...repository,
    async updateInvoiceState(invoice: string, state: "UNPAID" | "SETTLED" | "FAILED") {
      const current = await repository.findByInvoiceOrThrow(invoice);
      await repository.updateInvoiceState(invoice, "FAILED");
      const conflict = new Error(`invalid invoice state transition: ${current.invoiceState} -> ${state}`);
      conflict.name = "InvoiceStateTransitionError";
      throw conflict;
    },
  };

  const status = await handleTipStatus(
    {
      invoice: response.invoice,
    },
    {
      tipIntentRepo: conflictRepo,
      ledgerRepo,
      tipIntentEventRepo,
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
      tipIntentEventRepo,
      adapter,
    },
  );

  expect(retried.state).toBe("FAILED");
  expect(ledgerRepo.__listForTests?.()).toHaveLength(1);
});

it("lists newly settled tip notifications with a stable cursor", async () => {
  let invoiceCounter = 0;
  const feedAdapter = {
    ...adapter,
    async createInvoice() {
      invoiceCounter += 1;
      return { invoice: `inv-tip-feed-${invoiceCounter}` };
    },
  };

  const first = await handleTipCreate({
    appId: "app1",
    postId: "post-1",
    fromUserId: "u1",
    toUserId: "u2",
    asset: "CKB",
    amount: "31",
    message: "Great post",
  }, { tipIntentRepo, tipIntentEventRepo, adapter: feedAdapter });
  invoiceStatusByInvoice[first.invoice] = "SETTLED";
  await handleTipStatus({ invoice: first.invoice }, { tipIntentRepo, ledgerRepo, tipIntentEventRepo, adapter });

  await new Promise((resolve) => setTimeout(resolve, 5));

  const second = await handleTipCreate({
    appId: "app1",
    postId: "post-2",
    fromUserId: "u3",
    toUserId: "u2",
    asset: "CKB",
    amount: "15",
    message: "Second",
  }, { tipIntentRepo, tipIntentEventRepo, adapter: feedAdapter });
  invoiceStatusByInvoice[second.invoice] = "SETTLED";
  await handleTipStatus({ invoice: second.invoice }, { tipIntentRepo, ledgerRepo, tipIntentEventRepo, adapter });

  const { handleTipSettledFeed } = await import("./tip");
  const fullFeed = await handleTipSettledFeed({ appId: "app1", limit: 10 }, { tipIntentRepo });
  expect(fullFeed.items).toHaveLength(2);
  expect(fullFeed.items[0]).toMatchObject({
    postId: "post-1",
    toUserId: "u2",
    message: "Great post",
  });

  const afterFirst = await handleTipSettledFeed({
    appId: "app1",
    after: {
      settledAt: fullFeed.items[0].settledAt,
      id: fullFeed.items[0].tipIntentId,
    },
    limit: 10,
  }, { tipIntentRepo });
  expect(afterFirst.items).toHaveLength(1);
  expect(afterFirst.items[0]).toMatchObject({ postId: "post-2", message: "Second" });
});

it("fails status when invoice is unknown", async () => {
  await expect(handleTipStatus({ invoice: "missing-invoice" }, { tipIntentRepo, ledgerRepo, tipIntentEventRepo, adapter })).rejects.toThrow(
    "tip intent not found",
  );
});

it("rethrows non-conflict errors while settling", async () => {
  const response = await handleTipCreate(
    {
      appId: "app1",
      postId: "p1",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
    },
    { tipIntentRepo, tipIntentEventRepo, adapter },
  );
  invoiceStatusByInvoice[response.invoice] = "SETTLED";

  const repoWithUnexpectedFailure = {
    ...tipIntentRepo,
    async updateInvoiceState() {
      throw new Error("db down");
    },
  };

  await expect(
    handleTipStatus(
      { invoice: response.invoice },
      {
        tipIntentRepo: repoWithUnexpectedFailure,
        ledgerRepo,
        tipIntentEventRepo,
        adapter,
      },
    ),
  ).rejects.toThrow("db down");
});

it("rethrows non-conflict errors while failing", async () => {
  const response = await handleTipCreate(
    {
      appId: "app1",
      postId: "p1",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
    },
    { tipIntentRepo, tipIntentEventRepo, adapter },
  );
  invoiceStatusByInvoice[response.invoice] = "FAILED";

  const repoWithUnexpectedFailure = {
    ...tipIntentRepo,
    async updateInvoiceState() {
      throw new Error("db timeout");
    },
  };

  await expect(
    handleTipStatus(
      { invoice: response.invoice },
      {
        tipIntentRepo: repoWithUnexpectedFailure,
        ledgerRepo,
        tipIntentEventRepo,
        adapter,
      },
    ),
  ).rejects.toThrow("db timeout");
});
