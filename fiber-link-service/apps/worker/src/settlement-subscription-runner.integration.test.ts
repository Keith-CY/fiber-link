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
});
