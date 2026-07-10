import crypto from "node:crypto";
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

function timingSafeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

let warnedMissingProxySecret = false;

/**
 * Resolve the trusted admin identity from the proxy-injected headers, falling
 * back to the development env defaults. The reverse proxy is responsible for
 * stripping any externally supplied `x-admin-*` headers before injecting the
 * trusted values (see the revamp design's authentication section).
 *
 * When ADMIN_PROXY_SHARED_SECRET is configured, identity headers are only
 * honored if the request also carries a matching `x-admin-proxy-token` header
 * (which the reverse proxy injects alongside the identity headers). This
 * protects deployments where the console port is reachable without going
 * through the proxy: a direct request can no longer claim a role by setting
 * `x-admin-role` itself. A mismatching or missing token fails closed to "no
 * role", including the dev env fallback.
 */
export function createTrpcContext(opts: CreateNextContextOptions): TrpcContext {
  const env = process.env;
  // The default-identity env fallback exists only for local dev, fixtures, and
  // the acceptance harness. In production the reverse proxy MUST inject the
  // trusted identity headers, so a header-less request resolves to no role
  // rather than silently becoming ADMIN_DASHBOARD_DEFAULT_ROLE (e.g. SUPER_ADMIN).
  const allowEnvFallback = env.NODE_ENV !== "production";

  const proxySharedSecret = env.ADMIN_PROXY_SHARED_SECRET?.trim();
  if (proxySharedSecret) {
    const proxyToken = readHeader(opts.req, "x-admin-proxy-token")?.trim() ?? "";
    if (!timingSafeEquals(proxyToken, proxySharedSecret)) {
      return { role: undefined, adminUserId: undefined, services: createAdminServices(env) };
    }
  } else if (env.NODE_ENV === "production" && !warnedMissingProxySecret) {
    warnedMissingProxySecret = true;
    console.warn(
      "[admin] ADMIN_PROXY_SHARED_SECRET is not set: identity headers are trusted from any " +
        "client that can reach this port. Set the shared secret and configure the reverse " +
        "proxy to send x-admin-proxy-token so direct requests cannot spoof x-admin-role.",
    );
  }

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
