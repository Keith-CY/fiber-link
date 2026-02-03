export function requireRole(required: "SUPER_ADMIN" | "COMMUNITY_ADMIN", actual?: string) {
  if (actual !== required) {
    throw new Error("FORBIDDEN");
  }
}
