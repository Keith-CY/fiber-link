import {
  WithdrawalNotFoundError,
  WithdrawalTransitionConflictError,
  createDbClient,
  createDbWithdrawalRepo,
  type WithdrawalRecord,
  type WithdrawalRepo,
} from "@fiber-link/db";

export type WithdrawalExecutionResult =
  | { ok: true }
  | { ok: false; kind: "transient" | "permanent"; reason: string };

export type RunWithdrawalBatchOptions = {
  now?: Date;
  maxRetries?: number;
  retryDelayMs?: number;
  executeWithdrawal?: (withdrawal: WithdrawalRecord) => Promise<WithdrawalExecutionResult>;
  repo?: WithdrawalRepo;
};

async function defaultExecuteWithdrawal(_: WithdrawalRecord): Promise<WithdrawalExecutionResult> {
  return { ok: true };
}

let defaultRepo: WithdrawalRepo | null = null;

function getDefaultRepo(): WithdrawalRepo {
  if (!defaultRepo) {
    defaultRepo = createDbWithdrawalRepo(createDbClient());
  }
  return defaultRepo;
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
      result = {
        ok: false,
        kind: "permanent",
        reason: error instanceof Error ? error.message : "withdrawal execution failed",
      };
    }

    processed += 1;
    if (result.ok) {
      await repo.markCompleted(item.id, now);
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
