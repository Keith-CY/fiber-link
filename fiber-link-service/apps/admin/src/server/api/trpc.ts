import { initTRPC } from "@trpc/server";
import type { DbClient, UserRole } from "@fiber-link/db";

export type TrpcContext = {
  role?: UserRole;
  // Identity of the admin user from BetterAuth (needed to scope COMMUNITY_ADMIN access).
  adminUserId?: string;
  db?: DbClient;
};

export const t = initTRPC.context<TrpcContext>().create();
