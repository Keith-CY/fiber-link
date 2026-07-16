import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { DbClient } from "./client";
import { type UserRole, adminAuditEvents } from "./schema";

export type AppendAdminAuditEventInput = {
  actorId: string;
  actorRole: UserRole;
  action: string;
  targetType: string;
  targetId: string;
  requestId: string;
  reason?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

export type AdminAuditEventRecord = AppendAdminAuditEventInput & {
  id: string;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: Date;
};

export type AdminAuditRepo = {
  append(input: AppendAdminAuditEventInput): Promise<AdminAuditEventRecord>;
  listRecentByTarget(targetType: string, targetId: string, limit?: number): Promise<AdminAuditEventRecord[]>;
  __resetForTests?: () => void;
  __listForTests?: () => AdminAuditEventRecord[];
};

type Row = typeof adminAuditEvents.$inferSelect;

function toRecord(row: Row): AdminAuditEventRecord {
  return {
    id: row.id,
    actorId: row.actorId,
    actorRole: row.actorRole,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    requestId: row.requestId,
    reason: row.reason ?? null,
    before: row.before ?? null,
    after: row.after ?? null,
    createdAt: row.createdAt,
  };
}

export function createDbAdminAuditRepo(db: DbClient): AdminAuditRepo {
  return {
    async append(input) {
      const [row] = await db
        .insert(adminAuditEvents)
        .values({
          actorId: input.actorId,
          actorRole: input.actorRole,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId,
          requestId: input.requestId,
          reason: input.reason ?? null,
          before: input.before ?? null,
          after: input.after ?? null,
        })
        .returning();
      return toRecord(row);
    },

    async listRecentByTarget(targetType, targetId, limit = 50) {
      const rows = await db
        .select()
        .from(adminAuditEvents)
        .where(eq(adminAuditEvents.targetType, targetType))
        .orderBy(desc(adminAuditEvents.createdAt), desc(adminAuditEvents.id))
        .limit(limit);
      return rows.filter((r) => r.targetId === targetId).map(toRecord);
    },
  };
}

export function createInMemoryAdminAuditRepo(): AdminAuditRepo {
  let records: AdminAuditEventRecord[] = [];
  return {
    async append(input) {
      const record: AdminAuditEventRecord = {
        id: randomUUID(),
        actorId: input.actorId,
        actorRole: input.actorRole,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        requestId: input.requestId,
        reason: input.reason ?? null,
        before: input.before ?? null,
        after: input.after ?? null,
        createdAt: new Date(),
      };
      records.push(record);
      return { ...record };
    },
    async listRecentByTarget(targetType, targetId, limit = 50) {
      return records
        .filter((r) => r.targetType === targetType && r.targetId === targetId)
        .slice()
        .reverse()
        .slice(0, limit);
    },
    __resetForTests() {
      records = [];
    },
    __listForTests() {
      return records.map((r) => ({ ...r }));
    },
  };
}
