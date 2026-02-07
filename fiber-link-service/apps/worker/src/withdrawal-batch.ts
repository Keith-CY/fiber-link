import {
  getWithdrawalByIdOrThrow,
  listWithdrawalsReadyForProcessing,
  markWithdrawalCompleted,
  markWithdrawalFailed,
  markWithdrawalProcessing,
  markWithdrawalRetryPending,
  type WithdrawalRecord,
} from "../../rpc/src/methods/withdrawal";

export type WithdrawalExecutionResult =
  | { ok: true }
  | { ok: false; kind: "transient" | "permanent"; reason: string };

export type RunWithdrawalBatchOptions = {
  now?: Date;
  maxRetries?: number;
  retryDelayMs?: number;
  executeWithdrawal?: (withdrawal: WithdrawalRecord) => Promise<WithdrawalExecutionResult>;
};

async function defaultExecuteWithdrawal(_: WithdrawalRecord): Promise<WithdrawalExecutionResult> {
  return { ok: true };
}

export async function runWithdrawalBatch(options: RunWithdrawalBatchOptions = {}) {
  const now = options.now ?? new Date();
  const maxRetries = options.maxRetries ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 60_000;
  const executeWithdrawal = options.executeWithdrawal ?? defaultExecuteWithdrawal;

  const ready = await listWithdrawalsReadyForProcessing(now);
  let processed = 0;
  let completed = 0;
  let retryPending = 0;
  let failed = 0;

  for (const item of ready) {
    await markWithdrawalProcessing(item.id, now);
    const current = await getWithdrawalByIdOrThrow(item.id);

    let result: WithdrawalExecutionResult;
    try {
      result = await executeWithdrawal(current);
    } catch (error) {
      result = {
        ok: false,
        kind: "transient",
        reason: error instanceof Error ? error.message : "withdrawal execution failed",
      };
    }

    processed += 1;
    if (result.ok) {
      await markWithdrawalCompleted(item.id, now);
      completed += 1;
      continue;
    }

    if (result.kind === "transient") {
      const nextRetryCount = current.retryCount + 1;
      if (nextRetryCount >= maxRetries) {
        await markWithdrawalFailed(item.id, {
          now,
          error: result.reason,
          incrementRetryCount: true,
        });
        failed += 1;
      } else {
        await markWithdrawalRetryPending(item.id, {
          now,
          nextRetryAt: new Date(now.getTime() + retryDelayMs),
          error: result.reason,
        });
        retryPending += 1;
      }
      continue;
    }

    await markWithdrawalFailed(item.id, { now, error: result.reason });
    failed += 1;
  }

  return { processed, completed, retryPending, failed };
}
