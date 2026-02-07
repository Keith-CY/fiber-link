import { randomUUID } from "crypto";

export type TipAsset = "CKB" | "USDI";
export type InvoiceState = "UNPAID" | "SETTLED" | "FAILED";

export type CreateTipIntentInput = {
  appId: string;
  postId: string;
  fromUserId: string;
  toUserId: string;
  asset: TipAsset;
  amount: string;
  invoice: string;
};

export type TipIntentRecord = CreateTipIntentInput & {
  id: string;
  invoiceState: InvoiceState;
  createdAt: Date;
  settledAt: Date | null;
};

const records: TipIntentRecord[] = [];

async function create(input: CreateTipIntentInput): Promise<TipIntentRecord> {
  if (records.some((item) => item.invoice === input.invoice)) {
    throw new Error("duplicate invoice");
  }

  const record: TipIntentRecord = {
    ...input,
    id: randomUUID(),
    invoiceState: "UNPAID",
    createdAt: new Date(),
    settledAt: null,
  };

  records.push(record);
  return record;
}

async function findByInvoiceOrThrow(invoice: string): Promise<TipIntentRecord> {
  const matches = records.filter((item) => item.invoice === invoice);
  if (matches.length !== 1) {
    throw new Error("invoice does not resolve to exactly one tip intent");
  }
  return matches[0];
}

async function updateInvoiceState(invoice: string, state: InvoiceState): Promise<TipIntentRecord> {
  const record = await findByInvoiceOrThrow(invoice);
  if (record.invoiceState === state) {
    return record;
  }

  record.invoiceState = state;
  if (state === "SETTLED" && !record.settledAt) {
    record.settledAt = new Date();
  }
  if (state !== "SETTLED") {
    record.settledAt = null;
  }
  return record;
}

function resetForTests() {
  records.length = 0;
}

export const tipIntentRepo = {
  create,
  findByInvoiceOrThrow,
  updateInvoiceState,
  __resetForTests: resetForTests,
};
