import { TRPCError } from "@trpc/server";
import { assertPositiveAmount, compareDecimalStrings, withdrawalPolicies, type Asset } from "@fiber-link/db";
import { requireRole } from "../../auth/roles";
import { t } from "../trpc";

type WithdrawalPolicyInput = {
  appId: string;
  allowedAssets: Asset[];
  maxPerRequest: string;
  perUserDailyMax: string;
  perAppDailyMax: string;
  cooldownSeconds: number;
};

function isSupportedAsset(value: unknown): value is Asset {
  return value === "CKB" || value === "USDI";
}

function parseUpsertInput(raw: unknown): WithdrawalPolicyInput {
  if (!raw || typeof raw !== "object") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "input must be an object" });
  }
  const input = raw as Record<string, unknown>;

  const appId = typeof input.appId === "string" ? input.appId.trim() : "";
  if (!appId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "appId is required" });
  }

  if (!Array.isArray(input.allowedAssets)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "allowedAssets must be an array" });
  }

  const normalizedAssets = Array.from(new Set(input.allowedAssets.filter(isSupportedAsset)));
  if (normalizedAssets.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "allowedAssets must include CKB or USDI" });
  }

  const maxPerRequest = typeof input.maxPerRequest === "string" ? input.maxPerRequest.trim() : "";
  const perUserDailyMax = typeof input.perUserDailyMax === "string" ? input.perUserDailyMax.trim() : "";
  const perAppDailyMax = typeof input.perAppDailyMax === "string" ? input.perAppDailyMax.trim() : "";
  if (!maxPerRequest || !perUserDailyMax || !perAppDailyMax) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "maxPerRequest, perUserDailyMax, and perAppDailyMax are required",
    });
  }

  try {
    assertPositiveAmount(maxPerRequest);
    assertPositiveAmount(perUserDailyMax);
    assertPositiveAmount(perAppDailyMax);
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "maxPerRequest, perUserDailyMax, and perAppDailyMax must be positive decimals",
    });
  }

  if (compareDecimalStrings(maxPerRequest, perUserDailyMax) > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "maxPerRequest must be <= perUserDailyMax",
    });
  }

  const cooldownSeconds = Number(input.cooldownSeconds);
  if (!Number.isInteger(cooldownSeconds) || cooldownSeconds < 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "cooldownSeconds must be an integer >= 0" });
  }

  return {
    appId,
    allowedAssets: normalizedAssets,
    maxPerRequest,
    perUserDailyMax,
    perAppDailyMax,
    cooldownSeconds,
  };
}

export const withdrawalPolicyRouter = t.router({
  list: t.procedure.query(async ({ ctx }) => {
    requireRole(["SUPER_ADMIN", "COMMUNITY_ADMIN"], ctx.role);
    if (!ctx.db) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not configured" });
    }

    const columns = {
      appId: true,
      allowedAssets: true,
      maxPerRequest: true,
      perUserDailyMax: true,
      perAppDailyMax: true,
      cooldownSeconds: true,
      updatedBy: true,
      createdAt: true,
      updatedAt: true,
    } as const;

    if (ctx.role === "SUPER_ADMIN") {
      return ctx.db.query.withdrawalPolicies.findMany({ columns });
    }

    if (!ctx.adminUserId) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Admin identity not configured",
      });
    }

    const memberships = await ctx.db.query.appAdmins.findMany({
      columns: { appId: true },
      where: (a, { eq: dbEq }) => dbEq(a.adminUserId, ctx.adminUserId),
    });
    const appIds = memberships.map((m) => m.appId);
    if (appIds.length === 0) {
      return [];
    }

    return ctx.db.query.withdrawalPolicies.findMany({
      columns,
      where: (p, { inArray: dbInArray }) => dbInArray(p.appId, appIds),
    });
  }),

  upsert: t.procedure.input({ parse: (value: unknown) => value }).mutation(async ({ ctx, input }) => {
    requireRole(["SUPER_ADMIN", "COMMUNITY_ADMIN"], ctx.role);
    if (!ctx.db) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not configured" });
    }

    const parsed = parseUpsertInput(input);

    if (ctx.role === "COMMUNITY_ADMIN") {
      if (!ctx.adminUserId) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Admin identity not configured",
        });
      }

      const memberships = await ctx.db.query.appAdmins.findMany({
        columns: { appId: true },
        where: (a, { eq: dbEq }) => dbEq(a.adminUserId, ctx.adminUserId),
      });
      const appIds = memberships.map((m) => m.appId);
      if (!appIds.includes(parsed.appId)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "COMMUNITY_ADMIN can only update policies for managed apps",
        });
      }
    }

    const now = new Date();
    const updatedBy = ctx.adminUserId ?? null;
    await ctx.db
      .insert(withdrawalPolicies)
      .values({
        appId: parsed.appId,
        allowedAssets: parsed.allowedAssets,
        maxPerRequest: parsed.maxPerRequest,
        perUserDailyMax: parsed.perUserDailyMax,
        perAppDailyMax: parsed.perAppDailyMax,
        cooldownSeconds: parsed.cooldownSeconds,
        updatedBy,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: withdrawalPolicies.appId,
        set: {
          allowedAssets: parsed.allowedAssets,
          maxPerRequest: parsed.maxPerRequest,
          perUserDailyMax: parsed.perUserDailyMax,
          perAppDailyMax: parsed.perAppDailyMax,
          cooldownSeconds: parsed.cooldownSeconds,
          updatedBy,
          updatedAt: now,
        },
      });

    const rows = await ctx.db.query.withdrawalPolicies.findMany({
      columns: {
        appId: true,
        allowedAssets: true,
        maxPerRequest: true,
        perUserDailyMax: true,
        perAppDailyMax: true,
        cooldownSeconds: true,
        updatedBy: true,
        createdAt: true,
        updatedAt: true,
      },
      where: (p, { eq: dbEq }) => dbEq(p.appId, parsed.appId),
    });
    const row = rows[0];

    if (!row) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "failed to persist withdrawal policy" });
    }

    return row;
  }),
});
