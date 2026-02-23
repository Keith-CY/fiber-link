import { randomUUID } from "crypto";
import { asc, eq } from "drizzle-orm";
import type { DbClient } from "./client";
import { tipIntentEvents, type InvoiceState, type TipIntentEventSource, type TipIntentEventType } from "./schema";

export type TipIntentEventMetadata = Record<string, unknown>;

export type AppendTipIntentEventInput = {
  tipIntentId: string;
  invoice: string;
  source: TipIntentEventSource;
  type: TipIntentEventType;
  previousInvoiceState?: InvoiceState | null;
  nextInvoiceState?: InvoiceState | null;
  metadata?: TipIntentEventMetadata | null;
  createdAt?: Date;
};

export type TipIntentEventRecord = {
  id: string;
  tipIntentId: string;
  invoice: string;
  source: TipIntentEventSource;
  type: TipIntentEventType;
  previousInvoiceState: InvoiceState | null;
  nextInvoiceState: InvoiceState | null;
  metadata: TipIntentEventMetadata | null;
  createdAt: Date;
};

export type TipIntentEventListOptions = {
  limit?: number;
};

export type TipIntentEventRepo = {
  append(input: AppendTipIntentEventInput): Promise<TipIntentEventRecord>;
  listByTipIntentId(tipIntentId: string, options?: TipIntentEventListOptions): Promise<TipIntentEventRecord[]>;
  __listForTests?: () => TipIntentEventRecord[];
  __resetForTests?: () => void;
};

type TipIntentEventRow = typeof tipIntentEvents.$inferSelect;

function normalizeMetadata(metadata: unknown): TipIntentEventMetadata | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  return metadata as TipIntentEventMetadata;
}

function cloneMetadata(metadata: TipIntentEventMetadata | null): TipIntentEventMetadata | null {
  if (!metadata) {
    return null;
  }
  return JSON.parse(JSON.stringify(metadata)) as TipIntentEventMetadata;
}

function toRecord(row: TipIntentEventRow): TipIntentEventRecord {
  return {
    id: row.id,
    tipIntentId: row.tipIntentId,
    invoice: row.invoice,
    source: row.source as TipIntentEventSource,
    type: row.type as TipIntentEventType,
    previousInvoiceState: (row.previousInvoiceState as InvoiceState | null) ?? null,
    nextInvoiceState: (row.nextInvoiceState as InvoiceState | null) ?? null,
    metadata: normalizeMetadata(row.metadata),
    createdAt: row.createdAt,
  };
}

export function createDbTipIntentEventRepo(db: DbClient): TipIntentEventRepo {
  return {
    async append(input) {
      const createdAt = input.createdAt ?? new Date();
      const [row] = await db
        .insert(tipIntentEvents)
        .values({
          tipIntentId: input.tipIntentId,
          invoice: input.invoice,
          source: input.source,
          type: input.type,
          previousInvoiceState: input.previousInvoiceState ?? null,
          nextInvoiceState: input.nextInvoiceState ?? null,
          metadata: input.metadata ?? null,
          createdAt,
        })
        .returning();
      return toRecord(row);
    },

    async listByTipIntentId(tipIntentId, options = {}) {
      let query = db
        .select()
        .from(tipIntentEvents)
        .where(eq(tipIntentEvents.tipIntentId, tipIntentId))
        .orderBy(asc(tipIntentEvents.createdAt), asc(tipIntentEvents.id));
      if (options.limit && options.limit > 0) {
        query = query.limit(options.limit);
      }
      const rows = await query;
      return rows.map(toRecord);
    },
  };
}

export function createInMemoryTipIntentEventRepo(): TipIntentEventRepo {
  const records: TipIntentEventRecord[] = [];

  function clone(record: TipIntentEventRecord): TipIntentEventRecord {
    return {
      ...record,
      metadata: cloneMetadata(record.metadata),
      createdAt: new Date(record.createdAt),
    };
  }

  return {
    async append(input) {
      const record: TipIntentEventRecord = {
        id: randomUUID(),
        tipIntentId: input.tipIntentId,
        invoice: input.invoice,
        source: input.source,
        type: input.type,
        previousInvoiceState: input.previousInvoiceState ?? null,
        nextInvoiceState: input.nextInvoiceState ?? null,
        metadata: cloneMetadata(input.metadata ?? null),
        createdAt: input.createdAt ? new Date(input.createdAt) : new Date(),
      };
      records.push(record);
      return clone(record);
    },

    async listByTipIntentId(tipIntentId, options = {}) {
      let items = records.filter((record) => record.tipIntentId === tipIntentId);
      items = items.sort((left, right) => {
        const createdAtDiff = left.createdAt.getTime() - right.createdAt.getTime();
        if (createdAtDiff !== 0) {
          return createdAtDiff;
        }
        return left.id.localeCompare(right.id);
      });
      if (options.limit && options.limit > 0) {
        items = items.slice(0, options.limit);
      }
      return items.map(clone);
    },

    __listForTests() {
      return records.map(clone);
    },

    __resetForTests() {
      records.length = 0;
    },
  };
}
