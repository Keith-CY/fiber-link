import { randomUUID } from "crypto";

export type LedgerCreditInput = {
  appId: string;
  userId: string;
  asset: "CKB" | "USDI";
  amount: string;
  refId: string;
  idempotencyKey: string;
};

export type LedgerEntryRecord = LedgerCreditInput & {
  id: string;
  type: "credit";
  createdAt: Date;
};

const entries: LedgerEntryRecord[] = [];

async function creditOnce(input: LedgerCreditInput): Promise<{ applied: boolean; entry?: LedgerEntryRecord }> {
  const exists = entries.find((item) => item.idempotencyKey === input.idempotencyKey);
  if (exists) {
    return { applied: false, entry: exists };
  }

  const entry: LedgerEntryRecord = {
    ...input,
    id: randomUUID(),
    type: "credit",
    createdAt: new Date(),
  };
  entries.push(entry);
  return { applied: true, entry };
}

function listForTests() {
  return [...entries];
}

function resetForTests() {
  entries.length = 0;
}

export const ledgerRepo = {
  creditOnce,
  __listForTests: listForTests,
  __resetForTests: resetForTests,
};
