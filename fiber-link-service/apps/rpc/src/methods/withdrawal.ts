import { randomUUID } from "crypto";

export type RequestWithdrawalInput = {
  appId: string;
  userId: string;
  asset: "CKB" | "USDI";
  amount: string;
  toAddress: string;
};

export type WithdrawalState = "PENDING" | "PROCESSING" | "RETRY_PENDING" | "COMPLETED" | "FAILED";

export type WithdrawalRecord = RequestWithdrawalInput & {
  id: string;
  state: WithdrawalState;
  retryCount: number;
  nextRetryAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

const records: WithdrawalRecord[] = [];

function cloneRecord(record: WithdrawalRecord): WithdrawalRecord {
  return {
    ...record,
    nextRetryAt: record.nextRetryAt ? new Date(record.nextRetryAt) : null,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    completedAt: record.completedAt ? new Date(record.completedAt) : null,
  };
}

export async function requestWithdrawal(input: RequestWithdrawalInput) {
  const now = new Date();
  const record: WithdrawalRecord = {
    ...input,
    id: randomUUID(),
    state: "PENDING",
    retryCount: 0,
    nextRetryAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
  records.push(record);
  return { id: record.id, state: record.state };
}

export async function getWithdrawalByIdOrThrow(id: string): Promise<WithdrawalRecord> {
  const record = records.find((item) => item.id === id);
  if (!record) {
    throw new Error("withdrawal not found");
  }
  return cloneRecord(record);
}

export async function listWithdrawalsReadyForProcessing(now: Date): Promise<WithdrawalRecord[]> {
  return records
    .filter(
      (item) =>
        item.state === "PENDING" ||
        (item.state === "RETRY_PENDING" && item.nextRetryAt !== null && item.nextRetryAt <= now),
    )
    .map(cloneRecord);
}

export async function markWithdrawalProcessing(id: string, now: Date): Promise<WithdrawalRecord> {
  const record = records.find((item) => item.id === id);
  if (!record) {
    throw new Error("withdrawal not found");
  }
  if (record.state !== "PENDING" && record.state !== "RETRY_PENDING") {
    throw new Error(`invalid transition to PROCESSING from ${record.state}`);
  }

  record.state = "PROCESSING";
  record.updatedAt = now;
  return cloneRecord(record);
}

export async function markWithdrawalCompleted(id: string, now: Date): Promise<WithdrawalRecord> {
  const record = records.find((item) => item.id === id);
  if (!record) {
    throw new Error("withdrawal not found");
  }
  if (record.state !== "PROCESSING") {
    throw new Error(`invalid transition to COMPLETED from ${record.state}`);
  }

  record.state = "COMPLETED";
  record.completedAt = now;
  record.nextRetryAt = null;
  record.lastError = null;
  record.updatedAt = now;
  return cloneRecord(record);
}

export async function markWithdrawalRetryPending(
  id: string,
  params: { now: Date; nextRetryAt: Date; error: string },
): Promise<WithdrawalRecord> {
  const record = records.find((item) => item.id === id);
  if (!record) {
    throw new Error("withdrawal not found");
  }
  if (record.state !== "PROCESSING") {
    throw new Error(`invalid transition to RETRY_PENDING from ${record.state}`);
  }

  record.state = "RETRY_PENDING";
  record.retryCount += 1;
  record.nextRetryAt = params.nextRetryAt;
  record.lastError = params.error;
  record.updatedAt = params.now;
  return cloneRecord(record);
}

export async function markWithdrawalFailed(
  id: string,
  params: { now: Date; error: string; incrementRetryCount?: boolean },
): Promise<WithdrawalRecord> {
  const record = records.find((item) => item.id === id);
  if (!record) {
    throw new Error("withdrawal not found");
  }
  if (record.state !== "PROCESSING") {
    throw new Error(`invalid transition to FAILED from ${record.state}`);
  }

  if (params.incrementRetryCount) {
    record.retryCount += 1;
  }
  record.state = "FAILED";
  record.nextRetryAt = null;
  record.lastError = params.error;
  record.updatedAt = params.now;
  return cloneRecord(record);
}

export function __resetWithdrawalStoreForTests() {
  records.length = 0;
}
