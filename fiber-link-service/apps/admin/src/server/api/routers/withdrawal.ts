import { randomUUID } from "crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { adminAuditEvents, withdrawals, type DbClient, type UserRole, type WithdrawalState } from "@fiber-link/db";
import { requireRole } from "../../auth/roles";
import { t } from "../trpc";

type WithdrawalListInput = {
  id?: string;
  state?: WithdrawalState | WithdrawalState[];
  appId?: string;
  userId?: string;
  txHash?: string;
  minAgeSeconds?: number;
  maxAgeSeconds?: number;
};

type WithdrawalActionInput = {
  id: string;
  reason?: string;
  requestId?: string;
  txHash?: string;
  note?: string;
};

type WithdrawalRow = typeof withdrawals.$inferSelect;

type ScopedWithdrawalRow = Pick<
  WithdrawalRow,
  | "id"
  | "appId"
  | "userId"
  | "asset"
  | "amount"
  | "destinationKind"
  | "toAddress"
  | "state"
  | "retryCount"
  | "nextRetryAt"
  | "lastError"
  | "createdAt"
  | "updatedAt"
  | "completedAt"
  | "txHash"
  | "liquidityRequestId"
  | "liquidityPendingReason"
  | "liquidityCheckedAt"
>;

const withdrawalColumns = {
  id: true,
  appId: true,
  userId: true,
  asset: true,
  amount: true,
  destinationKind: true,
  toAddress: true,
  state: true,
  retryCount: true,
  nextRetryAt: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
  txHash: true,
  liquidityRequestId: true,
  liquidityPendingReason: true,
  liquidityCheckedAt: true,
} as const;

function parseInput<T extends object>(value: unknown): T {
  return (value && typeof value === "object" ? value : {}) as T;
}

function normalizeReason(reason: unknown, fallback: string): string {
  const text = typeof reason === "string" ? reason.trim() : "";
  return text || fallback;
}

function normalizeRequiredText(value: unknown, label: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${label} is required` });
  }
  return text;
}

function txExplorerUrl(txHash: string | null): string | null {
  if (!txHash) return null;
  const baseUrl =
    process.env.CKB_EXPLORER_BASE_URL?.trim() || process.env.NERVOS_EXPLORER_BASE_URL?.trim() || "https://explorer.nervos.org";
  return `${baseUrl.replace(/\/$/, "")}/transaction/${txHash}`;
}

function serializeWithdrawal(row: ScopedWithdrawalRow, now = new Date()) {
  return {
    id: row.id,
    appId: row.appId,
    userId: row.userId,
    asset: row.asset,
    amount: typeof row.amount === "string" ? row.amount : String(row.amount),
    destinationKind: row.destinationKind,
    toAddress: row.toAddress,
    state: row.state,
    retryCount: row.retryCount,
    nextRetryAt: row.nextRetryAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    txHash: row.txHash,
    txExplorerUrl: txExplorerUrl(row.txHash),
    liquidityRequestId: row.liquidityRequestId,
    liquidityPendingReason: row.liquidityPendingReason,
    liquidityCheckedAt: row.liquidityCheckedAt,
    ageSeconds: Math.max(0, Math.floor((now.getTime() - row.createdAt.getTime()) / 1000)),
  };
}

async function getCommunityAdminAppIds(ctx: { db: DbClient; adminUserId?: string }): Promise<string[]> {
  if (!ctx.adminUserId) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Admin identity not configured",
    });
  }
  const adminUserId = ctx.adminUserId;
  const memberships = await ctx.db.query.appAdmins.findMany({
    columns: { appId: true },
    where: (a, { eq: dbEq }) => dbEq(a.adminUserId, adminUserId),
  });
  return memberships.map((m) => m.appId);
}

async function listScopedWithdrawals(
  ctx: { db: DbClient; role?: UserRole; adminUserId?: string },
  input: WithdrawalListInput = {},
  now = new Date(),
): Promise<ScopedWithdrawalRow[]> {
  const scopedAppIds = ctx.role === "SUPER_ADMIN" ? undefined : await getCommunityAdminAppIds(ctx);
  if (scopedAppIds?.length === 0) {
    return [];
  }

  return ctx.db.query.withdrawals.findMany({
    columns: withdrawalColumns,
    where: (w, { and: dbAnd, eq: dbEq, gte: dbGte, inArray: dbInArray, lte: dbLte }) => {
      const states = input.state ? (Array.isArray(input.state) ? input.state : [input.state]) : undefined;
      const predicates: SQL[] = [];
      if (input.id) predicates.push(dbEq(w.id, input.id));
      if (scopedAppIds) predicates.push(dbInArray(w.appId, scopedAppIds));
      if (states?.length) predicates.push(dbInArray(w.state, states));
      if (input.appId) predicates.push(dbEq(w.appId, input.appId));
      if (input.userId) predicates.push(dbEq(w.userId, input.userId));
      const txHash = input.txHash?.trim().toLowerCase();
      if (txHash) predicates.push(sql`lower(coalesce(${w.txHash}, '')) like ${`%${txHash}%`}`);
      if (typeof input.minAgeSeconds === "number") {
        predicates.push(dbLte(w.createdAt, new Date(now.getTime() - input.minAgeSeconds * 1000)));
      }
      if (typeof input.maxAgeSeconds === "number") {
        predicates.push(dbGte(w.createdAt, new Date(now.getTime() - input.maxAgeSeconds * 1000)));
      }
      return predicates.length ? dbAnd(...predicates) : undefined;
    },
  }) as Promise<ScopedWithdrawalRow[]>;
}

async function findAuthorizedWithdrawalOrThrow(ctx: { db: DbClient; role?: UserRole; adminUserId?: string }, id: string) {
  const rows = await listScopedWithdrawals(ctx, { id });
  const row = rows.find((item) => item.id === id);
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "withdrawal not found in admin scope" });
  }
  return row;
}

function assertAdminActor(ctx: { role?: UserRole; adminUserId?: string }) {
  requireRole(["SUPER_ADMIN", "COMMUNITY_ADMIN"], ctx.role);
  if (!ctx.adminUserId) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Admin identity not configured" });
  }
}

function assertNoPriorBroadcastTx(before: ScopedWithdrawalRow, targetAction: string) {
  if (!before.txHash) return;
  throw new TRPCError({
    code: "CONFLICT",
    message: `${targetAction} cannot re-queue a withdrawal that already has a transaction hash`,
  });
}

function assertCurrentState(before: ScopedWithdrawalRow, allowedStates: WithdrawalState[], targetAction: string) {
  if (allowedStates.includes(before.state)) return;
  throw new TRPCError({
    code: "CONFLICT",
    message: `${targetAction} is not valid for the current withdrawal state`,
  });
}

async function writeAuditEvent(args: {
  db: DbClient;
  actorId: string;
  actorRole: UserRole;
  action: string;
  targetId: string;
  requestId: string;
  reason?: string;
  before: ScopedWithdrawalRow | null;
  after: ScopedWithdrawalRow | null;
}) {
  await args.db.insert(adminAuditEvents).values({
    actorId: args.actorId,
    actorRole: args.actorRole,
    action: args.action,
    targetType: "withdrawal",
    targetId: args.targetId,
    requestId: args.requestId,
    reason: args.reason ?? null,
    before: args.before ? serializeWithdrawal(args.before) : null,
    after: args.after ? serializeWithdrawal(args.after) : null,
  });
}

async function runWithdrawalAction(
  ctx: { db?: DbClient; role?: UserRole; adminUserId?: string },
  action: string,
  rawInput: unknown,
  update: (db: DbClient, before: ScopedWithdrawalRow, now: Date, input: WithdrawalActionInput) => Promise<ScopedWithdrawalRow>,
) {
  requireRole(["SUPER_ADMIN", "COMMUNITY_ADMIN"], ctx.role);
  if (!ctx.db) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not configured" });
  }
  assertAdminActor({ role: ctx.role, adminUserId: ctx.adminUserId });
  const input = parseInput<WithdrawalActionInput>(rawInput);
  const id = normalizeRequiredText(input.id, "id");
  const requestId = input.requestId?.trim() || randomUUID();
  const before = await findAuthorizedWithdrawalOrThrow({ db: ctx.db, role: ctx.role, adminUserId: ctx.adminUserId }, id);
  const now = new Date();
  const after = await update(ctx.db, before, now, input);
  await writeAuditEvent({
    db: ctx.db,
    actorId: ctx.adminUserId!,
    actorRole: ctx.role!,
    action,
    targetId: id,
    requestId,
    reason: input.reason ?? input.note,
    before,
    after,
  });
  return serializeWithdrawal(after, now);
}

async function updateByIdOrConflict(
  db: DbClient,
  id: string,
  allowedStates: WithdrawalState[],
  values: Partial<typeof withdrawals.$inferInsert>,
  targetAction: string,
): Promise<ScopedWithdrawalRow> {
  const rows = await db
    .update(withdrawals)
    .set(values)
    .where(and(eq(withdrawals.id, id), inArray(withdrawals.state, allowedStates)))
    .returning();
  const row = rows[0] as ScopedWithdrawalRow | undefined;
  if (!row) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `${targetAction} is not valid for the current withdrawal state`,
    });
  }
  return row;
}

async function updateByIdWithNullTxOrConflict(
  db: DbClient,
  id: string,
  allowedStates: WithdrawalState[],
  values: Partial<typeof withdrawals.$inferInsert>,
  targetAction: string,
): Promise<ScopedWithdrawalRow> {
  const rows = await db
    .update(withdrawals)
    .set(values)
    .where(and(eq(withdrawals.id, id), inArray(withdrawals.state, allowedStates), isNull(withdrawals.txHash)))
    .returning();
  const row = rows[0] as ScopedWithdrawalRow | undefined;
  if (!row) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `${targetAction} is not valid for the current withdrawal state or already has a transaction hash`,
    });
  }
  return row;
}

export const withdrawalRouter = t.router({
  list: t.procedure.input({ parse: parseInput<WithdrawalListInput> }).query(async ({ ctx, input }) => {
    requireRole(["SUPER_ADMIN", "COMMUNITY_ADMIN"], ctx.role);
    if (!ctx.db) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not configured" });
    }

    const now = new Date();
    const rows = await listScopedWithdrawals({ db: ctx.db, role: ctx.role, adminUserId: ctx.adminUserId }, input, now);
    return rows.map((row) => serializeWithdrawal(row, now));
  }),

  retryNow: t.procedure.input({ parse: parseInput<WithdrawalActionInput> }).mutation(({ ctx, input }) =>
    runWithdrawalAction(ctx, "withdrawal.retryNow", input, (db, before, now) => {
      assertNoPriorBroadcastTx(before, "retryNow");
      return updateByIdWithNullTxOrConflict(
        db,
        before.id,
        ["FAILED", "RETRY_PENDING"],
        { state: "PENDING", nextRetryAt: null, lastError: null, updatedAt: now },
        "retryNow",
      );
    }),
  ),

  pause: t.procedure.input({ parse: parseInput<WithdrawalActionInput> }).mutation(({ ctx, input }) =>
    runWithdrawalAction(ctx, "withdrawal.pause", input, (db, before, now, parsed) =>
      updateByIdOrConflict(
        db,
        before.id,
        ["PENDING", "RETRY_PENDING", "LIQUIDITY_PENDING"],
        {
          state: "FAILED",
          nextRetryAt: null,
          lastError: `Paused by admin: ${normalizeReason(parsed.reason, "manual pause")}`,
          updatedAt: now,
        },
        "pause",
      ),
    ),
  ),

  resume: t.procedure.input({ parse: parseInput<WithdrawalActionInput> }).mutation(({ ctx, input }) =>
    runWithdrawalAction(ctx, "withdrawal.resume", input, (db, before, now) => {
      const state = before.state === "LIQUIDITY_PENDING" ? "LIQUIDITY_PENDING" : "RETRY_PENDING";
      const updateWithdrawal = before.state === "FAILED" ? updateByIdWithNullTxOrConflict : updateByIdOrConflict;
      if (before.state === "FAILED") assertNoPriorBroadcastTx(before, "resume");
      return updateWithdrawal(
        db,
        before.id,
        ["PENDING", "RETRY_PENDING", "LIQUIDITY_PENDING", "FAILED"],
        { state, nextRetryAt: now, lastError: null, updatedAt: now },
        "resume",
      );
    }),
  ),

  cancelBeforeBroadcast: t.procedure.input({ parse: parseInput<WithdrawalActionInput> }).mutation(({ ctx, input }) =>
    runWithdrawalAction(ctx, "withdrawal.cancelBeforeBroadcast", input, (db, before, now, parsed) => {
      assertCurrentState(before, ["LIQUIDITY_PENDING", "PENDING", "RETRY_PENDING", "FAILED"], "cancelBeforeBroadcast");
      return updateByIdOrConflict(
        db,
        before.id,
        ["LIQUIDITY_PENDING", "PENDING", "RETRY_PENDING", "FAILED"],
        {
          state: "FAILED",
          nextRetryAt: null,
          lastError: `Cancelled by admin before broadcast: ${normalizeReason(parsed.reason, "manual cancellation")}`,
          updatedAt: now,
        },
        "cancelBeforeBroadcast",
      );
    }),
  ),

  recheckConfirmation: t.procedure.input({ parse: parseInput<WithdrawalActionInput> }).mutation(({ ctx, input }) =>
    runWithdrawalAction(ctx, "withdrawal.recheckConfirmation", input, (db, before, now) =>
      updateByIdOrConflict(
        db,
        before.id,
        ["BROADCASTED"],
        { state: "BROADCASTED", lastError: null, updatedAt: now },
        "recheckConfirmation",
      ),
    ),
  ),

  attachTx: t.procedure.input({ parse: parseInput<WithdrawalActionInput> }).mutation(({ ctx, input }) =>
    runWithdrawalAction(ctx, "withdrawal.attachTx", input, (db, before, now, parsed) => {
      const txHash = normalizeRequiredText(parsed.txHash, "txHash");
      assertCurrentState(before, ["BROADCASTED"], "attachTx");
      return updateByIdOrConflict(
        db,
        before.id,
        ["BROADCASTED"],
        {
          state: "BROADCASTED",
          txHash,
          nextRetryAt: null,
          lastError: null,
          updatedAt: now,
        },
        "attachTx",
      );
    }),
  ),

  addOpsNote: t.procedure.input({ parse: parseInput<WithdrawalActionInput> }).mutation(({ ctx, input }) =>
    runWithdrawalAction(ctx, "withdrawal.addOpsNote", input, async (db, before, now, parsed) => {
      const note = normalizeRequiredText(parsed.note, "note");
      const rows = await db
        .update(withdrawals)
        .set({ lastError: before.lastError ? `${before.lastError}\nOps note: ${note}` : `Ops note: ${note}`, updatedAt: now })
        .where(eq(withdrawals.id, before.id))
        .returning();
      return rows[0] as ScopedWithdrawalRow;
    }),
  ),
});
