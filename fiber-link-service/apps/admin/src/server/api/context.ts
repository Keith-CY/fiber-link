import type { CreateNextContextOptions } from "@trpc/server/adapters/next";
import type { IncomingMessage } from "node:http";
import { parseAdminRole } from "../../dashboard/dashboard-page-model";
import { createAdminServices } from "../services";
import type { TrpcContext } from "./trpc";

function readHeader(req: IncomingMessage, key: string): string | undefined {
  const value = req.headers[key];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

/**
 * Resolve the trusted admin identity from the proxy-injected headers, falling
 * back to the development env defaults. The reverse proxy is responsible for
 * stripping any externally supplied `x-admin-*` headers before injecting the
 * trusted values (see the revamp design's authentication section).
 */
export function createTrpcContext(opts: CreateNextContextOptions): TrpcContext {
  const env = process.env;
  // The default-identity env fallback exists only for local dev, fixtures, and
  // the acceptance harness. In production the reverse proxy MUST inject the
  // trusted identity headers, so a header-less request resolves to no role
  // rather than silently becoming ADMIN_DASHBOARD_DEFAULT_ROLE (e.g. SUPER_ADMIN).
  const allowEnvFallback = env.NODE_ENV !== "production";

  const headerRole = parseAdminRole(readHeader(opts.req, "x-admin-role"));
  const role = headerRole ?? (allowEnvFallback ? parseAdminRole(env.ADMIN_DASHBOARD_DEFAULT_ROLE) : undefined);

  const headerUserId = readHeader(opts.req, "x-admin-user-id")?.trim();
  const fallbackUserId = allowEnvFallback ? env.ADMIN_DASHBOARD_DEFAULT_ADMIN_USER_ID?.trim() : undefined;
  const adminUserId = headerUserId || fallbackUserId || undefined;

  return {
    role,
    adminUserId,
    services: createAdminServices(env),
  };
}
