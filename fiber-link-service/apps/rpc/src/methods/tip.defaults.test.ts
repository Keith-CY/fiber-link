import { beforeEach, describe, expect, it, vi } from "vitest";

type SetupOptions = {
  tipRepoInitError?: Error;
  eventRepoInitError?: Error;
  eventAppendError?: Error;
  statusState?: "UNPAID" | "SETTLED" | "FAILED";
};

async function setupTipModule(options: SetupOptions = {}) {
  vi.resetModules();

  const db = await import("@fiber-link/db");
  const adapterPkg = await import("@fiber-link/fiber-adapter");

  const tipRepo = db.createInMemoryTipIntentRepo();
  const ledgerRepo = db.createInMemoryLedgerRepo();
  const eventRepo = db.createInMemoryTipIntentEventRepo();

  if (options.eventAppendError) {
    eventRepo.append = vi.fn(async () => {
      throw options.eventAppendError;
    }) as never;
  }

  let invoiceCounter = 0;
  const adapter = {
    createInvoice: vi.fn(async () => {
      invoiceCounter += 1;
      return { invoice: `inv-default-${invoiceCounter}` };
    }),
    getInvoiceStatus: vi.fn(async () => ({ state: options.statusState ?? "SETTLED" })),
  };

  vi.spyOn(db, "createDbClient").mockReturnValue({} as never);
  vi.spyOn(db, "createDbTipIntentRepo").mockImplementation(() => {
    if (options.tipRepoInitError) {
      throw options.tipRepoInitError;
    }
    return tipRepo as never;
  });
  vi.spyOn(db, "createDbLedgerRepo").mockReturnValue(ledgerRepo as never);
  vi.spyOn(db, "createDbTipIntentEventRepo").mockImplementation(() => {
    if (options.eventRepoInitError) {
      throw options.eventRepoInitError;
    }
    return eventRepo as never;
  });
  const createAdapterProvider = vi
    .spyOn(adapterPkg, "createAdapterProvider")
    .mockReturnValue(adapter as never);

  const tipModule = await import("./tip");

  return {
    ...tipModule,
    tipRepo,
    ledgerRepo,
    eventRepo,
    adapter,
    db,
    createAdapterProvider,
  };
}

describe("tip defaults", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    process.env.FIBER_RPC_URL = "http://localhost:8119";
  });

  it("uses default repositories/adapter and caches them across calls", async () => {
    const { handleTipCreate, handleTipStatus, tipRepo, ledgerRepo, db, createAdapterProvider } = await setupTipModule({
      statusState: "SETTLED",
    });

    const first = await handleTipCreate({
      appId: "app-default",
      postId: "post-1",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
    });
    await handleTipStatus({ invoice: first.invoice });

    const second = await handleTipCreate({
      appId: "app-default",
      postId: "post-2",
      fromUserId: "u3",
      toUserId: "u4",
      asset: "USDI",
      amount: "11",
    });

    expect(db.createDbClient).toHaveBeenCalledTimes(3);
    expect(createAdapterProvider).toHaveBeenCalledTimes(1);
    expect((await tipRepo.findByInvoiceOrThrow(first.invoice)).invoiceState).toBe("SETTLED");
    expect((await tipRepo.findByInvoiceOrThrow(second.invoice)).invoiceState).toBe("UNPAID");
    expect(ledgerRepo.__listForTests?.()).toHaveLength(1);
  });

  it("continues tip create when event timeline append fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { handleTipCreate } = await setupTipModule({
      eventAppendError: new Error("append failed"),
      statusState: "UNPAID",
    });

    const result = await handleTipCreate({
      appId: "app-default",
      postId: "post-1",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
    });

    expect(result.invoice).toBe("inv-default-1");
    expect(
      consoleError.mock.calls.some(
        (call) => call[0] === "Failed to append tip intent timeline event." && String(call[1]).includes("append failed"),
      ),
    ).toBe(true);
  });

  it("continues tip create when event repo initialization fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { handleTipCreate, db } = await setupTipModule({
      eventRepoInitError: new Error("event repo init failed"),
      statusState: "UNPAID",
    });

    const result = await handleTipCreate({
      appId: "app-default",
      postId: "post-1",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI",
      amount: "10",
    });

    expect(result.invoice).toBe("inv-default-1");
    expect(db.createDbTipIntentEventRepo).toHaveBeenCalledTimes(1);
    expect(
      consoleError.mock.calls.some(
        (call) =>
          call[0] === "Failed to initialize default TipIntentEventRepo." &&
          String(call[1]).includes("event repo init failed"),
      ),
    ).toBe(true);
  });

  it("marks default tip repo unavailable after initialization failure", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { handleTipCreate } = await setupTipModule({
      tipRepoInitError: new Error("tip repo init failed"),
      statusState: "UNPAID",
    });

    const request = {
      appId: "app-default",
      postId: "post-1",
      fromUserId: "u1",
      toUserId: "u2",
      asset: "USDI" as const,
      amount: "10",
    };

    await expect(handleTipCreate(request)).rejects.toThrow("tip repo init failed");
    await expect(handleTipCreate(request)).rejects.toThrow(
      "TipIntentRepo is not available (DATABASE_URL missing).",
    );
    expect(
      consoleError.mock.calls.some(
        (call) =>
          call[0] === "Failed to initialize default TipIntentRepo." &&
          String(call[1]).includes("tip repo init failed"),
      ),
    ).toBe(true);
  });
});
