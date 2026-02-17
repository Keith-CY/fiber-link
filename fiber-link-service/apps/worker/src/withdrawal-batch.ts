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

type ExecutionFailureKind = "transient" | "permanent";

// Explicit contract table for withdrawal execution failure classification.
// Source/version assumptions:
// 1) JSON-RPC 2.0 error codes (-32700, -32600..-32603, -32000..-32099 server range).
// 2) Local adapter contract in packages/fiber-adapter/src/fiber-client.ts:
//    non-2xx responses throw FiberRpcError("Fiber RPC HTTP <status>").
const FIBER_WITHDRAWAL_ERROR_CONTRACT = {
  jsonRpcCodeKind: new Map<number, ExecutionFailureKind>([
    [-32700, "permanent"], // Parse error
    [-32600, "permanent"], // Invalid request
    [-32601, "permanent"], // Method not found
    [-32602, "permanent"], // Invalid params
    [-32603, "transient"], // Internal error
  ]),
  jsonRpcServerErrorRange: {
    min: -32099,
    max: -32000,
    kind: "transient" as const,
  },
  transientHttpStatus: new Set([408, 425, 429, 500, 502, 503, 504]),
  defaultFiberKind: "transient" as const,
  defaultUnknownKind: "permanent" as const,
};

function parseFiberHttpStatus(message: string): number | null {
  const matched = /^Fiber RPC HTTP (\d{3})$/.exec(message.trim());
  if (!matched) {
    return null;
  }
  const status = Number(matched[1]);
  return Number.isInteger(status) ? status : null;
}

function classifyFiberRpcError(error: FiberRpcError): ExecutionFailureKind {
  if (typeof error.code === "number") {
    const mappedCodeKind = FIBER_WITHDRAWAL_ERROR_CONTRACT.jsonRpcCodeKind.get(error.code);
    if (mappedCodeKind) {
      return mappedCodeKind;
    }
    const range = FIBER_WITHDRAWAL_ERROR_CONTRACT.jsonRpcServerErrorRange;
    if (error.code >= range.min && error.code <= range.max) {
      return range.kind;
    }
    return FIBER_WITHDRAWAL_ERROR_CONTRACT.defaultFiberKind;
  }

  const httpStatus = parseFiberHttpStatus(error.message);
  if (httpStatus !== null) {
    if (FIBER_WITHDRAWAL_ERROR_CONTRACT.transientHttpStatus.has(httpStatus)) {
      return "transient";
    }
    if (httpStatus >= 500 && httpStatus <= 599) {
      return "transient";
    }
    if (httpStatus >= 400 && httpStatus <= 499) {
      return "permanent";
    }
  }

  return FIBER_WITHDRAWAL_ERROR_CONTRACT.defaultFiberKind;
}

function classifyExecutionError(error: unknown): { kind: "transient" | "permanent"; reason: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof FiberRpcError) {
    return { kind: classifyFiberRpcError(error), reason: message };
  }
  return { kind: FIBER_WITHDRAWAL_ERROR_CONTRACT.defaultUnknownKind, reason: message };
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
