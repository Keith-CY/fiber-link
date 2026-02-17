import { beforeEach, describe, expect, it } from "vitest";
import {
  WithdrawalTransitionConflictError,
  createInMemoryLedgerRepo,
  createInMemoryWithdrawalRepo,
} from "@fiber-link/db";
import { FiberRpcError } from "@fiber-link/fiber-adapter";
import { runWithdrawalBatch } from "./withdrawal-batch";

describe("runWithdrawalBatch", () => {
  const repo = createInMemoryWithdrawalRepo();

  beforeEach(() => {
    repo.__resetForTests();
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
      now: new Date("2026-02-07T10:02:00.000Z"),
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
      toAddress: "ckt1q-first",
    });
    const second = await repo.create({
      appId: "app1",
      userId: "u2",
      asset: "USDI",
      amount: "20",
      toAddress: "ckt1q-second",
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

  it("does not use string heuristics for non-Fiber errors", async () => {
    const created = await createPendingWithdrawal("non-fiber-timeout");

    const res = await runWithdrawalBatch({
      now: new Date("2026-02-07T12:46:00.000Z"),
      executeWithdrawal: async () => {
        throw new Error("network timeout");
      },
      repo,
    });

    expect(res.failed).toBe(1);
    const saved = await repo.findByIdOrThrow(created.id);
    expect(saved.state).toBe("FAILED");
    expect(saved.retryCount).toBe(0);
    expect(saved.nextRetryAt).toBeNull();
  });
});
