import { beforeEach, describe, expect, it } from "vitest";
import {
  createInMemoryLedgerRepo,
  createInMemoryTipIntentRepo,
  type InvoiceState,
} from "@fiber-link/db";
import { runSettlementDiscovery } from "./settlement-discovery";
import { startSettlementSubscriptionRunner } from "./settlement-subscription-runner";

describe("settlement subscription strategy integration", () => {
  const tipIntentRepo = createInMemoryTipIntentRepo();
  const ledgerRepo = createInMemoryLedgerRepo();

  beforeEach(() => {
    tipIntentRepo.__resetForTests?.();
    ledgerRepo.__resetForTests?.();
  });

  it("processes subscription events and preserves polling fallback for missed invoices", async () => {
    const invoiceStates = new Map<string, InvoiceState>();
    let emit: ((invoice: string) => Promise<void>) | null = null;

    const adapter = {
      async subscribeSettlements(args: {
        onSettled: (invoice: string) => void | Promise<void>;
        onError?: (error: unknown) => void;
      }) {
        emit = async (invoice: string) => {
          await args.onSettled(invoice);
        };
        return {
          close: () => undefined,
        };
      },
      async getInvoiceStatus({ invoice }: { invoice: string }) {
        return { state: invoiceStates.get(invoice) ?? "UNPAID" };
      },
    };

    const subscriptionIntent = await tipIntentRepo.create({
      appId: "app-sub",
      postId: "post-sub",
      fromUserId: "from-sub",
      toUserId: "to-sub",
      asset: "USDI",
      amount: "10",
      invoice: "inv-sub-1",
    });
    const pollingIntent = await tipIntentRepo.create({
      appId: "app-poll",
      postId: "post-poll",
      fromUserId: "from-poll",
      toUserId: "to-poll",
      asset: "USDI",
      amount: "6",
      invoice: "inv-poll-1",
    });

    invoiceStates.set(subscriptionIntent.invoice, "SETTLED");
    invoiceStates.set(pollingIntent.invoice, "SETTLED");

    const runner = await startSettlementSubscriptionRunner({
      adapter,
      tipIntentRepo,
      ledgerRepo,
      logger: {
        info: () => undefined,
        error: () => undefined,
      },
    });

    await emit?.(subscriptionIntent.invoice);
    await emit?.(subscriptionIntent.invoice);

    const summary = await runSettlementDiscovery({
      limit: 10,
      adapter,
      tipIntentRepo,
      ledgerRepo,
    });
    await runner.close();

    expect(summary.scanned).toBe(1);
    expect(summary.settledCredits).toBe(1);
    expect(summary.settledDuplicates).toBe(0);

    const entries = ledgerRepo.__listForTests?.() ?? [];
    expect(entries).toHaveLength(2);
    expect(entries.filter((entry) => entry.refId === subscriptionIntent.id)).toHaveLength(1);
    expect(entries.filter((entry) => entry.refId === pollingIntent.id)).toHaveLength(1);
  });

  it("keeps polling fallback usable when subscription emits an invalid invoice", async () => {
    const invoiceStates = new Map<string, InvoiceState>();
    let emit: ((invoice: string) => Promise<void>) | null = null;

    const adapter = {
      async subscribeSettlements(args: {
        onSettled: (invoice: string) => void | Promise<void>;
        onError?: (error: unknown) => void;
      }) {
        emit = async (invoice: string) => {
          await args.onSettled(invoice);
        };
        return {
          close: () => undefined,
        };
      },
      async getInvoiceStatus({ invoice }: { invoice: string }) {
        return { state: invoiceStates.get(invoice) ?? "UNPAID" };
      },
    };

    const fallbackIntent = await tipIntentRepo.create({
      appId: "app-fallback",
      postId: "post-fallback",
      fromUserId: "from-fallback",
      toUserId: "to-fallback",
      asset: "USDI",
      amount: "8",
      invoice: "inv-fallback-1",
    });
    invoiceStates.set(fallbackIntent.invoice, "SETTLED");

    const runner = await startSettlementSubscriptionRunner({
      adapter,
      tipIntentRepo,
      ledgerRepo,
      logger: {
        info: () => undefined,
        error: () => undefined,
      },
    });

    await emit?.("missing-invoice");

    const summary = await runSettlementDiscovery({
      limit: 10,
      adapter,
      tipIntentRepo,
      ledgerRepo,
    });
    await runner.close();

    expect(summary.scanned).toBe(1);
    expect(summary.settledCredits).toBe(1);
    expect(ledgerRepo.__listForTests?.()).toHaveLength(1);
  });

  it("recovers overflow-dropped subscription events via polling fallback", async () => {
    const invoiceStates = new Map<string, InvoiceState>();
    let emitBurst: ((invoices: string[]) => void) | null = null;

    const adapter = {
      async subscribeSettlements(args: {
        onSettled: (invoice: string) => void | Promise<void>;
        onError?: (error: unknown) => void;
      }) {
        emitBurst = (invoices: string[]) => {
          for (const invoice of invoices) {
            void args.onSettled(invoice);
          }
        };
        return {
          close: () => undefined,
        };
      },
      async getInvoiceStatus({ invoice }: { invoice: string }) {
        return { state: invoiceStates.get(invoice) ?? "UNPAID" };
      },
    };

    const first = await tipIntentRepo.create({
      appId: "app-overflow",
      postId: "post-overflow-1",
      fromUserId: "from-overflow-1",
      toUserId: "to-overflow-1",
      asset: "USDI",
      amount: "3",
      invoice: "inv-overflow-1",
    });
    const second = await tipIntentRepo.create({
      appId: "app-overflow",
      postId: "post-overflow-2",
      fromUserId: "from-overflow-2",
      toUserId: "to-overflow-2",
      asset: "USDI",
      amount: "4",
      invoice: "inv-overflow-2",
    });
    const third = await tipIntentRepo.create({
      appId: "app-overflow",
      postId: "post-overflow-3",
      fromUserId: "from-overflow-3",
      toUserId: "to-overflow-3",
      asset: "USDI",
      amount: "5",
      invoice: "inv-overflow-3",
    });

    invoiceStates.set(first.invoice, "SETTLED");
    invoiceStates.set(second.invoice, "SETTLED");
    invoiceStates.set(third.invoice, "SETTLED");

    const overflowed: string[] = [];
    const runner = await startSettlementSubscriptionRunner({
      adapter,
      tipIntentRepo,
      ledgerRepo,
      maxPendingEvents: 0,
      onQueueOverflow(info) {
        overflowed.push(info.invoice);
      },
      logger: {
        info: () => undefined,
        error: () => undefined,
      },
    });

    emitBurst?.([first.invoice, second.invoice, third.invoice]);
    await runner.close();

    expect(overflowed).toHaveLength(2);

    const summary = await runSettlementDiscovery({
      limit: 10,
      adapter,
      tipIntentRepo,
      ledgerRepo,
    });

    expect(summary.scanned).toBe(2);
    expect(summary.settledCredits).toBe(2);
    expect(ledgerRepo.__listForTests?.()).toHaveLength(3);
  });
});
