import {
  WithdrawalNotFoundError,
  WithdrawalTransitionConflictError,
  createDbClient,
  createDbLedgerRepo,
  createDbWithdrawalRepo,
  type LedgerRepo,
  type WithdrawalRecord,
  type WithdrawalRepo,
} from "@fiber-link/db";
import { FiberRpcError, createAdapter } from "@fiber-link/fiber-adapter";

export type WithdrawalExecutionResult =
  | { ok: true; txHash: string }
  | { ok: false; kind: "transient" | "permanent"; reason: string };

export type RunWithdrawalBatchOptions = {
  now?: Date;
  maxRetries?: number;
  retryDelayMs?: number;
  executeWithdrawal?: (withdrawal: WithdrawalRecord) => Promise<WithdrawalExecutionResult>;
  ledgerRepo?: LedgerRepo;
  repo?: WithdrawalRepo;
};

async function defaultExecuteWithdrawal(withdrawal: WithdrawalRecord): Promise<WithdrawalExecutionResult> {
  const endpoint = process.env.FIBER_RPC_URL;
  if (!endpoint) {
    throw new Error("FIBER_RPC_URL is required for withdrawal execution");
  }
  const adapter = getDefaultFiberAdapter(endpoint);
  return {
    ok: true,
    txHash: (
      await adapter.executeWithdrawal({
        amount: withdrawal.amount,
        asset: withdrawal.asset,
        toAddress: withdrawal.toAddress,
        requestId: withdrawal.id,
      })
    ).txHash,
  };
}

let defaultRepo: WithdrawalRepo | null = null;
let defaultLedgerRepo: LedgerRepo | null = null;
let defaultFiberAdapter:
  | ReturnType<typeof createAdapter>
  | null = null;

function getDefaultRepo(): WithdrawalRepo {
  if (!defaultRepo) {
    defaultRepo = createDbWithdrawalRepo(createDbClient());
  }
  return defaultRepo;
}

function getDefaultLedgerRepo(): LedgerRepo {
  if (!defaultLedgerRepo) {
    defaultLedgerRepo = createDbLedgerRepo(createDbClient());
  }
  return defaultLedgerRepo;
}

function getDefaultFiberAdapter(endpoint: string) {
  if (!defaultFiberAdapter) {
    defaultFiberAdapter = createAdapter({ endpoint });
  }
  return defaultFiberAdapter;
}

function classifyExecutionError(error: unknown): { kind: "transient" | "permanent"; reason: string } {
  const message = error instanceof Error ? error.message : String(error);
  const transientPattern = /(timeout|temporar|busy|unavailable|connect|network|throttle|rate limit|econn)/i;
  if (error instanceof FiberRpcError) {
    const code = error.code;
    if (code === -32600 || code === -32601 || code === -32602) {
      return { kind: "permanent", reason: message };
    }
    if (code === -32603 || (typeof code === "number" && code <= -32000 && code >= -32099)) {
      return { kind: "transient", reason: message };
    }
    if (transientPattern.test(message)) {
      return { kind: "transient", reason: message };
    }
    return { kind: "permanent", reason: message };
  }
  if (transientPattern.test(message)) {
    return { kind: "transient", reason: message };
  }
  return { kind: "permanent", reason: message };
}

export async function runWithdrawalBatch(options: RunWithdrawalBatchOptions = {}) {
  const now = options.now ?? new Date();
  // maxRetries counts retry attempts after the initial processing attempt.
  const maxRetries = options.maxRetries ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 60_000;
  const executeWithdrawal = options.executeWithdrawal ?? defaultExecuteWithdrawal;
  const repo = options.repo ?? getDefaultRepo();

  const ready = await repo.listReadyForProcessing(now);
  let processed = 0;
  let completed = 0;
  let retryPending = 0;
  let failed = 0;
  let skipped = 0;

  for (const item of ready) {
    let current: WithdrawalRecord;
    try {
      current = await repo.markProcessing(item.id, now);
    } catch (error) {
      if (error instanceof WithdrawalTransitionConflictError || error instanceof WithdrawalNotFoundError) {
        // Another worker may have claimed/modified this record; continue batch.
        skipped += 1;
        continue;
      }
      throw error;
    }

    let result: WithdrawalExecutionResult;
    try {
      result = await executeWithdrawal(current);
    } catch (error) {
      const classified = classifyExecutionError(error);
      result = { ok: false, ...classified };
    }

    processed += 1;
    if (result.ok) {
      const ledgerRepo = options.ledgerRepo ?? getDefaultLedgerRepo();
      await repo.markCompletedWithDebit(item.id, { now, txHash: result.txHash }, { ledgerRepo });
      completed += 1;
      continue;
    }

    if (result.kind === "transient") {
      if (current.retryCount >= maxRetries) {
        await repo.markFailed(item.id, {
          now,
          error: result.reason,
        });
        failed += 1;
      } else {
        await repo.markRetryPending(item.id, {
          now,
          nextRetryAt: new Date(now.getTime() + retryDelayMs),
          error: result.reason,
        });
        retryPending += 1;
      }
      continue;
    }

    await repo.markFailed(item.id, { now, error: result.reason });
    failed += 1;
  }

  return { processed, completed, retryPending, failed, skipped };
}
