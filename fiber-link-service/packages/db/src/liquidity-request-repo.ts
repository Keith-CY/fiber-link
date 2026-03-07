import { randomUUID } from "crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { DbClient } from "./client";
import { assertPositiveAmount, compareDecimalStrings, formatDecimal, parseDecimal } from "./amount";
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

export type FindOpenLiquidityRequestByKeyInput = {
  appId: string;
  asset: Asset;
  network: string;
  sourceKind: LiquidityRequestSourceKind;
};

export class LiquidityRequestNotFoundError extends Error {
  constructor(public readonly liquidityRequestId: string) {
    super(`liquidity request not found: ${liquidityRequestId}`);
    this.name = "LiquidityRequestNotFoundError";
  }
}

export class LiquidityRequestStateTransitionError extends Error {
  constructor(
    public readonly liquidityRequestId: string,
    public readonly from: LiquidityRequestState,
    public readonly to: LiquidityRequestState,
  ) {
    super(`invalid liquidity request state transition: ${from} -> ${to}`);
    this.name = "LiquidityRequestStateTransitionError";
  }
}

export class LiquidityRequestFundingAmountError extends Error {
  constructor(
    public readonly liquidityRequestId: string,
    public readonly fundedAmount: string,
    public readonly requiredAmount: string,
  ) {
    super(
      `liquidity request ${liquidityRequestId} cannot be marked funded: fundedAmount ${fundedAmount} is below requiredAmount ${requiredAmount}`,
    );
    this.name = "LiquidityRequestFundingAmountError";
  }
}

export type LiquidityRequestRepo = {
  create(input: CreateLiquidityRequestInput): Promise<LiquidityRequestRecord>;
  findById(liquidityRequestId: string): Promise<LiquidityRequestRecord | null>;
  findByIdOrThrow(liquidityRequestId: string): Promise<LiquidityRequestRecord>;
  findOpenByKey(input: FindOpenLiquidityRequestByKeyInput): Promise<LiquidityRequestRecord | null>;
  listOpen(): Promise<LiquidityRequestRecord[]>;
  markFunded(liquidityRequestId: string, input: MarkLiquidityRequestFundedInput): Promise<LiquidityRequestRecord>;
  __listForTests?: () => LiquidityRequestRecord[];
  __resetForTests?: () => void;
};

type LiquidityRequestRow = typeof liquidityRequests.$inferSelect;
const OPEN_LIQUIDITY_REQUEST_STATES = ["REQUESTED", "REBALANCING"] as const;

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
  return OPEN_LIQUIDITY_REQUEST_STATES.includes(state as (typeof OPEN_LIQUIDITY_REQUEST_STATES)[number]);
}

function assertCanMarkFunded(record: LiquidityRequestRecord, fundedAmount: string): void {
  if (!isOpenState(record.state)) {
    throw new LiquidityRequestStateTransitionError(record.id, record.state, "FUNDED");
  }
  if (compareDecimalStrings(fundedAmount, record.requiredAmount) < 0) {
    throw new LiquidityRequestFundingAmountError(record.id, fundedAmount, record.requiredAmount);
  }
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

  async function findOpenByKey(input: FindOpenLiquidityRequestByKeyInput): Promise<LiquidityRequestRecord | null> {
    const [row] = await db
      .select()
      .from(liquidityRequests)
      .where(
        and(
          eq(liquidityRequests.appId, input.appId),
          eq(liquidityRequests.asset, input.asset),
          eq(liquidityRequests.network, input.network),
          eq(liquidityRequests.sourceKind, input.sourceKind),
          inArray(liquidityRequests.state, [...OPEN_LIQUIDITY_REQUEST_STATES]),
        ),
      )
      .orderBy(asc(liquidityRequests.createdAt), asc(liquidityRequests.id))
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

    findOpenByKey,

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
      const current = await findById(liquidityRequestId);
      if (!current) {
        throw new LiquidityRequestNotFoundError(liquidityRequestId);
      }
      assertCanMarkFunded(current, fundedAmount);
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
        .where(
          and(
            eq(liquidityRequests.id, liquidityRequestId),
            inArray(liquidityRequests.state, [...OPEN_LIQUIDITY_REQUEST_STATES]),
          ),
        )
        .returning();

      if (!row) {
        const latest = await findById(liquidityRequestId);
        if (!latest) {
          throw new LiquidityRequestNotFoundError(liquidityRequestId);
        }
        throw new LiquidityRequestStateTransitionError(liquidityRequestId, latest.state, "FUNDED");
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

  async function findOpenByKey(input: FindOpenLiquidityRequestByKeyInput): Promise<LiquidityRequestRecord | null> {
    const match = records
      .filter(
        (record) =>
          record.appId === input.appId &&
          record.asset === input.asset &&
          record.network === input.network &&
          record.sourceKind === input.sourceKind &&
          isOpenState(record.state),
      )
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id))[0];
    return match ? cloneRecord(match) : null;
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

    findOpenByKey,

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

      const fundedAmount = normalizeAmount(input.fundedAmount);
      assertCanMarkFunded(records[index], fundedAmount);
      const now = input.now ? new Date(input.now) : new Date();
      records[index] = {
        ...records[index],
        state: "FUNDED",
        fundedAmount,
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
