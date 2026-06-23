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
  const role =
    parseAdminRole(readHeader(opts.req, "x-admin-role")) ?? parseAdminRole(env.ADMIN_DASHBOARD_DEFAULT_ROLE);
  const headerUserId = readHeader(opts.req, "x-admin-user-id")?.trim();
  const adminUserId = headerUserId || env.ADMIN_DASHBOARD_DEFAULT_ADMIN_USER_ID?.trim() || undefined;

  return {
    role,
    adminUserId,
    services: createAdminServices(env),
  };
}
