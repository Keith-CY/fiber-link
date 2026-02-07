import {
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
  const maxRetries = options.maxRetries ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 60_000;
  const executeWithdrawal = options.executeWithdrawal ?? defaultExecuteWithdrawal;
  const repo = options.repo ?? getDefaultRepo();

  const ready = await repo.listReadyForProcessing(now);
  let processed = 0;
  let completed = 0;
  let retryPending = 0;
  let failed = 0;

  for (const item of ready) {
    await repo.markProcessing(item.id, now);
    const current = await repo.findByIdOrThrow(item.id);

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
      await repo.markCompleted(item.id, now);
      completed += 1;
      continue;
    }

    if (result.kind === "transient") {
      const nextRetryCount = current.retryCount + 1;
      if (nextRetryCount >= maxRetries) {
        await repo.markFailed(item.id, {
          now,
          error: result.reason,
          incrementRetryCount: true,
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

  return { processed, completed, retryPending, failed };
}
