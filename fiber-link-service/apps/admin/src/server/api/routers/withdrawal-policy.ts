import { TRPCError } from "@trpc/server";
import { withdrawalPolicies } from "@fiber-link/db";
import { requireRole } from "../../auth/roles";
import { t } from "../trpc";
import { parseWithdrawalPolicyInput } from "../../../withdrawal-policy-input";

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

    let parsed;
    try {
      parsed = parseWithdrawalPolicyInput(input);
    } catch (error) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: error instanceof Error ? error.message : "invalid withdrawal policy input",
      });
    }

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
