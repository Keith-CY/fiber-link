import { randomUUID } from "crypto";
import { asc, eq, inArray } from "drizzle-orm";
import type { DbClient } from "./client";
import { assertPositiveAmount, formatDecimal, parseDecimal } from "./amount";
import {
  liquidityRequests,
  type Asset,
  type LiquidityRequestSourceKind,
  type LiquidityRequestState,
} from "./schema";

export type LiquidityRequestMetadata = Record<string, unknown>;

export type CreateLiquidityRequestInput = {
  appId: string;
  asset: Asset;
  network: string;
  sourceKind: LiquidityRequestSourceKind;
  requiredAmount: string;
  metadata?: LiquidityRequestMetadata | null;
  createdAt?: Date;
};

export type MarkLiquidityRequestFundedInput = {
  fundedAmount: string;
  now?: Date;
  metadata?: LiquidityRequestMetadata | null;
};

export type LiquidityRequestRecord = {
  id: string;
  appId: string;
  asset: Asset;
  network: string;
  state: LiquidityRequestState;
  sourceKind: LiquidityRequestSourceKind;
  requiredAmount: string;
  fundedAmount: string;
  metadata: LiquidityRequestMetadata | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

export class LiquidityRequestNotFoundError extends Error {
  constructor(public readonly liquidityRequestId: string) {
    super(`liquidity request not found: ${liquidityRequestId}`);
    this.name = "LiquidityRequestNotFoundError";
  }
}

export type LiquidityRequestRepo = {
  create(input: CreateLiquidityRequestInput): Promise<LiquidityRequestRecord>;
  findById(liquidityRequestId: string): Promise<LiquidityRequestRecord | null>;
  findByIdOrThrow(liquidityRequestId: string): Promise<LiquidityRequestRecord>;
  listOpen(): Promise<LiquidityRequestRecord[]>;
  markFunded(liquidityRequestId: string, input: MarkLiquidityRequestFundedInput): Promise<LiquidityRequestRecord>;
  __listForTests?: () => LiquidityRequestRecord[];
  __resetForTests?: () => void;
};

type LiquidityRequestRow = typeof liquidityRequests.$inferSelect;

function normalizeMetadata(metadata: unknown): LiquidityRequestMetadata | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  return metadata as LiquidityRequestMetadata;
}

function cloneMetadata(metadata: LiquidityRequestMetadata | null): LiquidityRequestMetadata | null {
  if (!metadata) {
    return null;
  }
  return JSON.parse(JSON.stringify(metadata)) as LiquidityRequestMetadata;
}

function normalizeAmount(amount: string): string {
  assertPositiveAmount(amount);
  const parsed = parseDecimal(amount);
  return formatDecimal(parsed.value, parsed.scale);
}

function toRecord(row: LiquidityRequestRow): LiquidityRequestRecord {
  return {
    id: row.id,
    appId: row.appId,
    asset: row.asset as Asset,
    network: row.network,
    state: row.state as LiquidityRequestState,
    sourceKind: row.sourceKind as LiquidityRequestSourceKind,
    requiredAmount: typeof row.requiredAmount === "string" ? row.requiredAmount : String(row.requiredAmount),
    fundedAmount: typeof row.fundedAmount === "string" ? row.fundedAmount : String(row.fundedAmount),
    metadata: normalizeMetadata(row.metadata),
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt ? new Date(row.completedAt) : null,
  };
}

function cloneRecord(record: LiquidityRequestRecord): LiquidityRequestRecord {
  return {
    ...record,
    metadata: cloneMetadata(record.metadata),
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    completedAt: record.completedAt ? new Date(record.completedAt) : null,
  };
}

function isOpenState(state: LiquidityRequestState): boolean {
  return state === "REQUESTED" || state === "REBALANCING";
}

export function createDbLiquidityRequestRepo(db: DbClient): LiquidityRequestRepo {
  async function findById(liquidityRequestId: string): Promise<LiquidityRequestRecord | null> {
    const [row] = await db
      .select()
      .from(liquidityRequests)
      .where(eq(liquidityRequests.id, liquidityRequestId))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  return {
    async create(input) {
      const now = input.createdAt ? new Date(input.createdAt) : new Date();
      const requiredAmount = normalizeAmount(input.requiredAmount);
      const [row] = await db
        .insert(liquidityRequests)
        .values({
          appId: input.appId,
          asset: input.asset,
          network: input.network,
          state: "REQUESTED",
          sourceKind: input.sourceKind,
          requiredAmount,
          fundedAmount: "0",
          metadata: input.metadata ?? null,
          lastError: null,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        })
        .returning();
      return toRecord(row);
    },

    findById,

    async findByIdOrThrow(liquidityRequestId) {
      const row = await findById(liquidityRequestId);
      if (!row) {
        throw new LiquidityRequestNotFoundError(liquidityRequestId);
      }
      return row;
    },

    async listOpen() {
      const rows = await db
        .select()
        .from(liquidityRequests)
        .where(inArray(liquidityRequests.state, ["REQUESTED", "REBALANCING"]))
        .orderBy(asc(liquidityRequests.createdAt), asc(liquidityRequests.id));
      return rows.map(toRecord);
    },

    async markFunded(liquidityRequestId, input) {
      const fundedAmount = normalizeAmount(input.fundedAmount);
      const now = input.now ? new Date(input.now) : new Date();
      const [row] = await db
        .update(liquidityRequests)
        .set({
          state: "FUNDED",
          fundedAmount,
          metadata: input.metadata === undefined ? undefined : (input.metadata ?? null),
          lastError: null,
          updatedAt: now,
          completedAt: now,
        })
        .where(eq(liquidityRequests.id, liquidityRequestId))
        .returning();

      if (!row) {
        throw new LiquidityRequestNotFoundError(liquidityRequestId);
      }

      return toRecord(row);
    },
  };
}

export function createInMemoryLiquidityRequestRepo(
  initial: LiquidityRequestRecord[] = [],
): LiquidityRequestRepo {
  const records = initial.map((record) => cloneRecord(record));

  function findIndexById(liquidityRequestId: string): number {
    return records.findIndex((record) => record.id === liquidityRequestId);
  }

  async function findById(liquidityRequestId: string): Promise<LiquidityRequestRecord | null> {
    const index = findIndexById(liquidityRequestId);
    if (index === -1) {
      return null;
    }
    return cloneRecord(records[index]);
  }

  return {
    async create(input) {
      const now = input.createdAt ? new Date(input.createdAt) : new Date();
      const record: LiquidityRequestRecord = {
        id: randomUUID(),
        appId: input.appId,
        asset: input.asset,
        network: input.network,
        state: "REQUESTED",
        sourceKind: input.sourceKind,
        requiredAmount: normalizeAmount(input.requiredAmount),
        fundedAmount: "0",
        metadata: cloneMetadata(input.metadata ?? null),
        lastError: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      };
      records.push(record);
      return cloneRecord(record);
    },

    findById,

    async findByIdOrThrow(liquidityRequestId) {
      const record = await findById(liquidityRequestId);
      if (!record) {
        throw new LiquidityRequestNotFoundError(liquidityRequestId);
      }
      return record;
    },

    async listOpen() {
      return records
        .filter((record) => isOpenState(record.state))
        .sort((left, right) => {
          const createdAtDiff = left.createdAt.getTime() - right.createdAt.getTime();
          if (createdAtDiff !== 0) {
            return createdAtDiff;
          }
          return left.id.localeCompare(right.id);
        })
        .map(cloneRecord);
    },

    async markFunded(liquidityRequestId, input) {
      const index = findIndexById(liquidityRequestId);
      if (index === -1) {
        throw new LiquidityRequestNotFoundError(liquidityRequestId);
      }

      const now = input.now ? new Date(input.now) : new Date();
      records[index] = {
        ...records[index],
        state: "FUNDED",
        fundedAmount: normalizeAmount(input.fundedAmount),
        metadata: input.metadata === undefined ? records[index].metadata : cloneMetadata(input.metadata ?? null),
        lastError: null,
        updatedAt: now,
        completedAt: now,
      };
      return cloneRecord(records[index]);
    },

    __listForTests() {
      return records.map(cloneRecord);
    },

    __resetForTests() {
      records.length = 0;
    },
  };
}
