import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WithdrawalTransitionConflictError,
  createInMemoryLedgerRepo,
  createInMemoryWithdrawalRepo,
} from "@fiber-link/db";
import { FiberRpcError, WithdrawalExecutionError } from "@fiber-link/fiber-adapter";
import { runWithdrawalBatch } from "./withdrawal-batch";

describe("runWithdrawalBatch", () => {
  const repo = createInMemoryWithdrawalRepo();

  beforeEach(() => {
    repo.__resetForTests();
  });

  afterEach(() => {
    delete process.env.FIBER_RPC_URL;
    vi.unmock("@fiber-link/fiber-adapter");
    vi.resetModules();
  });

  async function createPendingWithdrawal(idSuffix: string) {
    return repo.create({
      appId: "app1",
      userId: `u-${idSuffix}`,
      asset: "USDI",
      amount: "10",
      toAddress: `fiber:invoice:${idSuffix}`,
    });
  }

  it("moves transient failure to RETRY_PENDING with nextRetryAt", async () => {
    const created = await repo.create({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "10",
      toAddress: "ckt1q...",
    });

    const now = new Date("2026-02-07T10:00:00.000Z");
    const res = await runWithdrawalBatch({
      now,
      retryDelayMs: 60_000,
      executeWithdrawal: async () => ({
        ok: false,
        kind: "transient",
        reason: "node busy",
      }),
      repo,
    });

    expect(res.processed).toBe(1);
    const saved = await repo.findByIdOrThrow(created.id);
    expect(saved.state).toBe("RETRY_PENDING");
    expect(saved.retryCount).toBe(1);
    expect(saved.nextRetryAt?.toISOString()).toBe("2026-02-07T10:01:00.000Z");
  });

  it("moves transient failure to FAILED after retry budget exhausted", async () => {
    const created = await repo.create({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "10",
      toAddress: "ckt1q...",
    });

    const executeWithdrawal = async () =>
      ({
        ok: false,
        kind: "transient",
        reason: "temporary network issue",
      }) as const;

    await runWithdrawalBatch({
      now: new Date("2026-02-07T10:00:00.000Z"),
      maxRetries: 2,
      retryDelayMs: 60_000,
      executeWithdrawal,
      repo,
    });
    await runWithdrawalBatch({
      now: new Date("2026-02-07T10:01:00.000Z"),
      maxRetries: 2,
      retryDelayMs: 60_000,
      executeWithdrawal,
      repo,
    });
    await runWithdrawalBatch({
      now: new Date("2026-02-07T10:03:00.000Z"),
      maxRetries: 2,
      retryDelayMs: 60_000,
      executeWithdrawal,
      repo,
    });

    const saved = await repo.findByIdOrThrow(created.id);
    expect(saved.state).toBe("FAILED");
    expect(saved.retryCount).toBe(2);
    expect(saved.nextRetryAt).toBeNull();
  });

  it("uses exponential backoff when scheduling a second transient retry", async () => {
    const created = await repo.create({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "10",
      toAddress: "ckt1q...",
    });

    const executeWithdrawal = async () =>
      ({
        ok: false,
        kind: "transient",
        reason: "temporary network issue",
      }) as const;

    await runWithdrawalBatch({
      now: new Date("2026-02-07T10:00:00.000Z"),
      maxRetries: 3,
      retryDelayMs: 60_000,
      executeWithdrawal,
      repo,
    });

    await runWithdrawalBatch({
      now: new Date("2026-02-07T10:01:00.000Z"),
      maxRetries: 3,
      retryDelayMs: 60_000,
      executeWithdrawal,
      repo,
    });

    const saved = await repo.findByIdOrThrow(created.id);
    expect(saved.state).toBe("RETRY_PENDING");
    expect(saved.retryCount).toBe(2);
    expect(saved.nextRetryAt?.toISOString()).toBe("2026-02-07T10:03:00.000Z");
  });

  it("treats unexpected executor exception as permanent failure", async () => {
    const created = await repo.create({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "10",
      toAddress: "ckt1q...",
    });

    const res = await runWithdrawalBatch({
      now: new Date("2026-02-07T10:00:00.000Z"),
      executeWithdrawal: async () => {
        throw new Error("invalid withdrawal payload");
      },
      repo,
    });

    expect(res.failed).toBe(1);
    const saved = await repo.findByIdOrThrow(created.id);
    expect(saved.state).toBe("FAILED");
    expect(saved.retryCount).toBe(0);
    expect(saved.nextRetryAt).toBeNull();
  });

  it("continues processing other items when markProcessing loses race", async () => {
    const ledger = createInMemoryLedgerRepo();
    const first = await repo.create({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "10",
      toAddress: "fiber:invoice:first",
    });
    const second = await repo.create({
      appId: "app1",
      userId: "u2",
      asset: "USDI",
      amount: "20",
      toAddress: "fiber:invoice:second",
    });

    const contentionRepo = {
      ...repo,
      async markProcessing(id: string, now: Date) {
        if (id === first.id) {
          throw new WithdrawalTransitionConflictError("PROCESSING", "PROCESSING", id);
        }
        return repo.markProcessing(id, now);
      },
    };

    const res = await runWithdrawalBatch({
      now: new Date("2026-02-07T11:00:00.000Z"),
      executeWithdrawal: async () => ({ ok: true, txHash: "0xrace-ok" }),
      repo: contentionRepo,
      ledgerRepo: ledger,
    });

    expect(res.processed).toBe(1);
    expect(res.skipped).toBe(1);
    const firstSaved = await repo.findByIdOrThrow(first.id);
    const secondSaved = await repo.findByIdOrThrow(second.id);
    expect(firstSaved.state).toBe("PENDING");
    expect(secondSaved.state).toBe("COMPLETED");
  });

  it("reaps stale PROCESSING withdrawals to RETRY_PENDING without executing them in the same batch", async () => {
    const created = await repo.create({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "10",
      toAddress: "fiber:invoice:stale-processing",
    });
    await repo.markProcessing(created.id, new Date("2026-02-07T11:58:00.000Z"));
    await repo.markRetryPending(created.id, {
      now: new Date("2026-02-07T11:59:00.000Z"),
      nextRetryAt: new Date("2026-02-07T12:00:00.000Z"),
      error: "previous transient failure",
    });
    await repo.markProcessing(created.id, new Date("2026-02-07T12:00:00.000Z"));
    const executeWithdrawal = vi.fn(async () => ({ ok: true, txHash: "0xshould-not-run" }) as const);

    const res = await runWithdrawalBatch({
      now: new Date("2026-02-07T12:10:00.000Z"),
      processingLeaseMs: 5 * 60_000,
      retryDelayMs: 60_000,
      executeWithdrawal,
      repo,
    });

    expect(res.processed).toBe(0);
    expect(res.reapedProcessing).toBe(1);
    expect(executeWithdrawal).not.toHaveBeenCalled();
    const saved = await repo.findByIdOrThrow(created.id);
    expect(saved.state).toBe("RETRY_PENDING");
    expect(saved.retryCount).toBe(2);
    expect(saved.lastError).toBe("processing lease expired");
    expect(saved.nextRetryAt?.toISOString()).toBe("2026-02-07T12:12:00.000Z");
  });

  it("does not reap fresh PROCESSING withdrawals", async () => {
    const created = await repo.create({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "10",
      toAddress: "fiber:invoice:fresh-processing",
    });
    await repo.markProcessing(created.id, new Date("2026-02-07T12:09:00.000Z"));
    const executeWithdrawal = vi.fn(async () => ({ ok: true, txHash: "0xshould-not-run" }) as const);

    const res = await runWithdrawalBatch({
      now: new Date("2026-02-07T12:10:00.000Z"),
      processingLeaseMs: 5 * 60_000,
      retryDelayMs: 60_000,
      executeWithdrawal,
      repo,
    });

    expect(res.processed).toBe(0);
    expect(res.reapedProcessing).toBe(0);
    expect(executeWithdrawal).not.toHaveBeenCalled();
    const saved = await repo.findByIdOrThrow(created.id);
    expect(saved.state).toBe("PROCESSING");
  });

  it("persists txHash evidence when withdrawal execution succeeds", async () => {
    const ledger = createInMemoryLedgerRepo();
    const created = await repo.create({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "10",
      toAddress: "fiber:invoice:ok",
    });

    const res = await runWithdrawalBatch({
      now: new Date("2026-02-07T12:00:00.000Z"),
      executeWithdrawal: async () => ({ ok: true, txHash: "0xabc123" }),
      repo,
      ledgerRepo: ledger,
    });

    expect(res.completed).toBe(1);
    const saved = await repo.findByIdOrThrow(created.id);
    expect(saved.state).toBe("COMPLETED");
    expect(saved.txHash).toBe("0xabc123");
  });

  it("writes a ledger debit when withdrawal completes", async () => {
    const ledger = createInMemoryLedgerRepo();
    const created = await repo.create({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "10",
      toAddress: "fiber:invoice:ok",
    });

    await runWithdrawalBatch({
      now: new Date("2026-02-07T12:10:00.000Z"),
      executeWithdrawal: async () => ({ ok: true, txHash: "0xabc123" }),
      repo,
      ledgerRepo: ledger,
    });

    const entries = ledger.__listForTests?.() ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("debit");
    expect(entries[0].idempotencyKey).toBe(`withdrawal:debit:${created.id}`);
  });

  it("dispatches a completion notification after successful execution", async () => {
    const ledger = createInMemoryLedgerRepo();
    const created = await repo.create({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "10",
      toAddress: "fiber:invoice:ok-notify",
    });
    const dispatchWithdrawalEvent = vi.fn(async () => ({
      matched: 0,
      attempted: 0,
      delivered: 0,
      failed: 0,
    }));

    const res = await runWithdrawalBatch({
      now: new Date("2026-02-07T12:15:00.000Z"),
      executeWithdrawal: async () => ({ ok: true, txHash: "0xnotifyok" }),
      repo,
      ledgerRepo: ledger,
      notificationDispatcher: { dispatchWithdrawalEvent },
    });

    expect(res.completed).toBe(1);
    expect(dispatchWithdrawalEvent).toHaveBeenCalledTimes(1);
    expect(dispatchWithdrawalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "WITHDRAWAL_COMPLETED",
        appId: "app1",
        userId: "u1",
        withdrawalId: created.id,
        txHash: "0xnotifyok",
      }),
    );
  });

  it("dispatches a retry notification when transient failures are retriable", async () => {
    await repo.create({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "10",
      toAddress: "fiber:invoice:retry-notify",
    });
    const dispatchWithdrawalEvent = vi.fn(async () => ({
      matched: 0,
      attempted: 0,
      delivered: 0,
      failed: 0,
    }));

    const res = await runWithdrawalBatch({
      now: new Date("2026-02-07T12:20:00.000Z"),
      retryDelayMs: 60_000,
      executeWithdrawal: async () => ({
        ok: false,
        kind: "transient",
        reason: "rpc overloaded",
      }),
      repo,
      notificationDispatcher: { dispatchWithdrawalEvent },
    });

    expect(res.retryPending).toBe(1);
    expect(dispatchWithdrawalEvent).toHaveBeenCalledTimes(1);
    const [event] = dispatchWithdrawalEvent.mock.calls[0];
    expect(event.type).toBe("WITHDRAWAL_RETRY_PENDING");
    expect(event.error).toContain("rpc overloaded");
    expect(event.retryCount).toBe(1);
    expect(event.nextRetryAt?.toISOString()).toBe("2026-02-07T12:21:00.000Z");
  });

  it("dispatches a failed notification for terminal failure outcomes", async () => {
    const created = await repo.create({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "10",
      toAddress: "fiber:invoice:failed-notify",
    });
    const dispatchWithdrawalEvent = vi.fn(async () => ({
      matched: 0,
      attempted: 0,
      delivered: 0,
      failed: 0,
    }));

    const res = await runWithdrawalBatch({
      now: new Date("2026-02-07T12:25:00.000Z"),
      executeWithdrawal: async () => ({
        ok: false,
        kind: "permanent",
        reason: "bad address format",
      }),
      repo,
      notificationDispatcher: { dispatchWithdrawalEvent },
    });

    expect(res.failed).toBe(1);
    expect(dispatchWithdrawalEvent).toHaveBeenCalledTimes(1);
    expect(dispatchWithdrawalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "WITHDRAWAL_FAILED",
        withdrawalId: created.id,
        error: "bad address format",
      }),
    );
  });

  it("keeps withdrawal transitions successful when notification dispatch fails", async () => {
    const ledger = createInMemoryLedgerRepo();
    const created = await repo.create({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "10",
      toAddress: "fiber:invoice:notify-error",
    });

    const res = await runWithdrawalBatch({
      now: new Date("2026-02-07T12:50:00.000Z"),
      executeWithdrawal: async () => ({ ok: true, txHash: "0xstillok" }),
      repo,
      ledgerRepo: ledger,
      notificationDispatcher: {
        dispatchWithdrawalEvent: vi.fn(async () => {
          throw new Error("notification provider unavailable");
        }),
      },
    });

    expect(res.completed).toBe(1);
    const saved = await repo.findByIdOrThrow(created.id);
    expect(saved.state).toBe("COMPLETED");
    expect(saved.txHash).toBe("0xstillok");
  });

  it("treats Fiber internal rpc error as transient and schedules retry", async () => {
    const created = await repo.create({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "10",
      toAddress: "fiber:invoice:retry",
    });

    const res = await runWithdrawalBatch({
      now: new Date("2026-02-07T12:30:00.000Z"),
      retryDelayMs: 60_000,
      executeWithdrawal: async () => {
        throw new FiberRpcError("internal error", -32603);
      },
      repo,
    });

    expect(res.retryPending).toBe(1);
    const saved = await repo.findByIdOrThrow(created.id);
    expect(saved.state).toBe("RETRY_PENDING");
    expect(saved.lastError).toContain("internal error");
  });

  it("respects adapter withdrawal execution error contract kind", async () => {
    const created = await repo.create({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "10",
      toAddress: "ckt1qcontractkind",
    });

    const res = await runWithdrawalBatch({
      now: new Date("2026-02-07T12:35:00.000Z"),
      retryDelayMs: 60_000,
      executeWithdrawal: async () => {
        throw new WithdrawalExecutionError("upstream transient", "transient");
      },
      repo,
    });

    expect(res.retryPending).toBe(1);
    const saved = await repo.findByIdOrThrow(created.id);
    expect(saved.state).toBe("RETRY_PENDING");
    expect(saved.retryCount).toBe(1);
  });

  it("treats Fiber invalid params rpc error as permanent failure", async () => {
    const created = await repo.create({
      appId: "app1",
      userId: "u1",
      asset: "USDI",
      amount: "10",
      toAddress: "fiber:invoice:bad",
    });

    const res = await runWithdrawalBatch({
      now: new Date("2026-02-07T12:40:00.000Z"),
      executeWithdrawal: async () => {
        throw new FiberRpcError("invalid params", -32602);
      },
      repo,
    });

    expect(res.failed).toBe(1);
    const saved = await repo.findByIdOrThrow(created.id);
    expect(saved.state).toBe("FAILED");
    expect(saved.lastError).toContain("invalid params");
  });

  it.each([-32700, -32600, -32601, -32602])(
    "maps Fiber JSON-RPC code %i to permanent failure",
    async (code) => {
      const created = await createPendingWithdrawal(`jsonrpc-perm-${code}`);

      const res = await runWithdrawalBatch({
        now: new Date("2026-02-07T12:41:00.000Z"),
        executeWithdrawal: async () => {
          throw new FiberRpcError(`rpc error ${code}`, code);
        },
        repo,
      });

      expect(res.failed).toBe(1);
      const saved = await repo.findByIdOrThrow(created.id);
      expect(saved.state).toBe("FAILED");
      expect(saved.retryCount).toBe(0);
      expect(saved.nextRetryAt).toBeNull();
    },
  );

  it.each([-32603, -32000, -32042, -32099])(
    "maps Fiber retryable code %i to transient failure",
    async (code) => {
      const created = await createPendingWithdrawal(`jsonrpc-transient-${code}`);

      const res = await runWithdrawalBatch({
        now: new Date("2026-02-07T12:42:00.000Z"),
        retryDelayMs: 60_000,
        executeWithdrawal: async () => {
          throw new FiberRpcError(`rpc error ${code}`, code);
        },
        repo,
      });

      expect(res.retryPending).toBe(1);
      const saved = await repo.findByIdOrThrow(created.id);
      expect(saved.state).toBe("RETRY_PENDING");
      expect(saved.retryCount).toBe(1);
    },
  );

  it.each([408, 425, 429, 500, 502, 503, 504])(
    "maps Fiber RPC HTTP %i to transient failure",
    async (status) => {
      const created = await createPendingWithdrawal(`http-transient-${status}`);

      const res = await runWithdrawalBatch({
        now: new Date("2026-02-07T12:43:00.000Z"),
        retryDelayMs: 60_000,
        executeWithdrawal: async () => {
          throw new FiberRpcError(`Fiber RPC HTTP ${status}`);
        },
        repo,
      });

      expect(res.retryPending).toBe(1);
      const saved = await repo.findByIdOrThrow(created.id);
      expect(saved.state).toBe("RETRY_PENDING");
      expect(saved.retryCount).toBe(1);
    },
  );

  it.each([400, 401, 403, 404, 422])("maps Fiber RPC HTTP %i to permanent failure", async (status) => {
    const created = await createPendingWithdrawal(`http-perm-${status}`);

    const res = await runWithdrawalBatch({
      now: new Date("2026-02-07T12:44:00.000Z"),
      executeWithdrawal: async () => {
        throw new FiberRpcError(`Fiber RPC HTTP ${status}`);
      },
      repo,
    });

    expect(res.failed).toBe(1);
    const saved = await repo.findByIdOrThrow(created.id);
    expect(saved.state).toBe("FAILED");
    expect(saved.retryCount).toBe(0);
  });

  it("maps unknown Fiber error code to transient fallback deterministically", async () => {
    const created = await createPendingWithdrawal("unknown-code");

    const res = await runWithdrawalBatch({
      now: new Date("2026-02-07T12:45:00.000Z"),
      retryDelayMs: 60_000,
      executeWithdrawal: async () => {
        throw new FiberRpcError("vendor extension code", 10001);
      },
      repo,
    });

    expect(res.retryPending).toBe(1);
    const saved = await repo.findByIdOrThrow(created.id);
    expect(saved.state).toBe("RETRY_PENDING");
    expect(saved.retryCount).toBe(1);
  });

  it.each([
    ["AbortError", Object.assign(new Error("aborted"), { name: "AbortError" })],
    ["ECONNRESET", Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })],
    ["ETIMEDOUT", Object.assign(new Error("request timed out"), { code: "ETIMEDOUT" })],
    ["timeout message", new Error("network timeout")],
  ])("maps non-Fiber %s withdrawal exception to transient retry", async (label, error) => {
    const created = await createPendingWithdrawal(`non-fiber-${label}`);

    const res = await runWithdrawalBatch({
      now: new Date("2026-02-07T12:46:00.000Z"),
      retryDelayMs: 60_000,
      executeWithdrawal: async () => {
        throw error;
      },
      repo,
    });

    expect(res.retryPending).toBe(1);
    const saved = await repo.findByIdOrThrow(created.id);
    expect(saved.state).toBe("RETRY_PENDING");
    expect(saved.retryCount).toBe(1);
  });

  it("uses adapter execution for USDI withdrawals to CKB addresses by default", async () => {
    const adapterExecuteWithdrawal = vi.fn().mockResolvedValue({ txHash: "0xusdi-chain" });
    const createAdapter = vi.fn(() => ({
      executeWithdrawal: adapterExecuteWithdrawal,
    }));
    process.env.FIBER_RPC_URL = "http://fiber-rpc.test";

    vi.doMock("@fiber-link/fiber-adapter", async () => {
      const actual = await vi.importActual<typeof import("@fiber-link/fiber-adapter")>("@fiber-link/fiber-adapter");
      return {
        ...actual,
        createAdapter,
      };
    });

    const { runWithdrawalBatch: runWithdrawalBatchWithMock } = await import("./withdrawal-batch");
    const localRepo = createInMemoryWithdrawalRepo();
    const ledger = createInMemoryLedgerRepo();
    const created = await localRepo.create({
      appId: "app1",
      userId: "u-usdi-chain",
      asset: "USDI",
      amount: "10",
      toAddress: "ckt1qyqwyxfa75whssgkq9ukkdd30d8c7txct0gq5f9mxs",
    });

    const res = await runWithdrawalBatchWithMock({
      now: new Date("2026-03-07T12:46:00.000Z"),
      repo: localRepo,
      ledgerRepo: ledger,
    });

    expect(res.broadcasted).toBe(1);
    expect(res.completed).toBe(0);
    expect(createAdapter).toHaveBeenCalledWith({ endpoint: "http://fiber-rpc.test" });
    expect(adapterExecuteWithdrawal).toHaveBeenCalledWith({
      amount: "10",
      asset: "USDI",
      destination: {
        kind: "CKB_ADDRESS",
        address: "ckt1qyqwyxfa75whssgkq9ukkdd30d8c7txct0gq5f9mxs",
      },
      requestId: created.id,
    });
    const saved = await localRepo.findByIdOrThrow(created.id);
    expect(saved.state).toBe("BROADCASTED");
    expect(saved.txHash).toBe("0xusdi-chain");
  });

  it("completes broadcasted CKB-address withdrawals only after chain commit", async () => {
    const ledger = createInMemoryLedgerRepo();
    const created = await repo.create({
      appId: "app1",
      userId: "u-chain-confirm",
      asset: "CKB",
      amount: "63",
      toAddress: "ckt1qchainconfirm",
    });

    const first = await runWithdrawalBatch({
      now: new Date("2026-03-07T12:50:00.000Z"),
      executeWithdrawal: async () => ({ ok: true, txHash: "0xchainhash" }),
      confirmWithdrawal: async () => ({ status: "PENDING" }),
      repo,
      ledgerRepo: ledger,
    });

    expect(first.broadcasted).toBe(1);
    expect(first.completed).toBe(0);
    const broadcasted = await repo.findByIdOrThrow(created.id);
    expect(broadcasted.state).toBe("BROADCASTED");
    expect(broadcasted.txHash).toBe("0xchainhash");
    expect(broadcasted.completedAt).toBeNull();

    const second = await runWithdrawalBatch({
      now: new Date("2026-03-07T12:51:00.000Z"),
      confirmWithdrawal: async () => ({ status: "COMMITTED" }),
      repo,
      ledgerRepo: ledger,
    });

    expect(second.processed).toBe(0);
    expect(second.completed).toBe(1);
    const completed = await repo.findByIdOrThrow(created.id);
    expect(completed.state).toBe("COMPLETED");
    expect(completed.completedAt?.toISOString()).toBe("2026-03-07T12:51:00.000Z");
  });
});
