import { TRPCError } from "@trpc/server";

export function requireRole(
  required: Array<"SUPER_ADMIN" | "COMMUNITY_ADMIN">,
  actual?: string
) {
  if (!actual || !required.includes(actual as "SUPER_ADMIN" | "COMMUNITY_ADMIN")) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
}
