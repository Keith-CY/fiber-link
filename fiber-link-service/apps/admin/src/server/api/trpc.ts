import type { UserRole } from "@fiber-link/db";
import { TRPCError, initTRPC } from "@trpc/server";
import superjson from "superjson";
import type { AdminScope, AdminServices } from "../services/types";

export type TrpcContext = {
  // Resolved from the trusted `x-admin-role` / `x-admin-user-id` proxy headers
  // (or the development env fallbacks). Undefined when no role was supplied.
  role?: UserRole;
  adminUserId?: string;
  /** Correlates every audit event written during one tRPC request. */
  requestId?: string;
  services: AdminServices;
};

const t = initTRPC.context<TrpcContext>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;
export const mergeRouters = t.mergeRouters;

/**
 * Requires either admin role and exposes the resolved {@link AdminScope} on the
 * context so downstream resolvers never re-derive identity/role narrowing.
 */
export const adminProcedure = t.procedure.use(({ ctx, next }) => {
  const role = ctx.role;
  if (role !== "SUPER_ADMIN" && role !== "COMMUNITY_ADMIN") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin role required" });
  }
  const scope: AdminScope = { role, adminUserId: ctx.adminUserId };
  return next({ ctx: { scope } });
});

/** Global controls (settlements, ops, financial/identity writes) are SUPER_ADMIN-only. */
export const superAdminProcedure = t.procedure.use(({ ctx, next }) => {
  const role = ctx.role;
  if (role !== "SUPER_ADMIN") {
    throw new TRPCError({ code: "FORBIDDEN", message: "SUPER_ADMIN role required" });
  }
  const scope: AdminScope = { role, adminUserId: ctx.adminUserId };
  return next({ ctx: { scope } });
});

/**
 * Record a durable audit event for an admin mutation. Uses the resolved
 * scope so the actor/role can never disagree with the authorization that
 * admitted the mutation. Never throws (the services impl logs failures).
 */
export async function recordAuditEvent(
  ctx: TrpcContext,
  scope: AdminScope,
  event: {
    action: string;
    targetType: string;
    targetId: string;
    reason?: string | null;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  },
): Promise<void> {
  await ctx.services.appendAuditEvent({
    actorId: scope.adminUserId ?? "unknown",
    actorRole: scope.role,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    requestId: ctx.requestId ?? "unknown",
    reason: event.reason ?? null,
    before: event.before ?? null,
    after: event.after ?? null,
  });
}
