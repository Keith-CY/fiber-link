import type { IncomingMessage } from "node:http";
import type { NextApiHandler, NextApiResponse } from "next";

function readHeader(req: IncomingMessage, key: string): string | undefined {
  const value = req.headers[key];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

/** Normalize a host[:port] for the origin's scheme so default ports compare equal. */
function normalizeHost(host: string, protocol: string): string | undefined {
  try {
    return new URL(`${protocol}//${host.trim()}`).host;
  } catch {
    return undefined;
  }
}

function reject(res: NextApiResponse, status: number, message: string): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ error: message }));
}

/**
 * Browser-set signals only: `Sec-Fetch-Site` when present (modern browsers),
 * otherwise `Origin` vs the request host. A missing Origin (curl, server-side
 * callers) is allowed; those requests carry no ambient browser credentials.
 * `X-Forwarded-Host` is accepted alongside `Host` because a reverse proxy may
 * rewrite Host; a cross-site page cannot set it without a CORS preflight.
 */
function isCrossSite(req: IncomingMessage): boolean {
  const fetchSite = readHeader(req, "sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite) {
    return fetchSite !== "same-origin" && fetchSite !== "none";
  }

  const origin = readHeader(req, "origin")?.trim();
  if (!origin) {
    return false;
  }
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    // Includes the opaque "null" origin (sandboxed iframes, file://).
    return true;
  }
  const candidates = [readHeader(req, "host"), readHeader(req, "x-forwarded-host")?.split(",")[0]];
  return !candidates.some((host) => host && normalizeHost(host, originUrl.protocol) === originUrl.host);
}

/**
 * Wrap the tRPC API handler so mutations (POST) only accept JSON bodies from
 * same-origin callers. tRPC also parses `multipart/form-data` and
 * `application/octet-stream`, which a plain cross-site HTML form (or a no-cors
 * fetch) can send without a CORS preflight; with cookie-based proxy auth or
 * the non-production env fallback that would run input-less mutations such as
 * `ops.captureBackup`. The console's own tRPC client always sends
 * `application/json`, and no route accepts file uploads. Queries (GET) pass
 * through untouched.
 */
export function withMutationRequestGuard(handler: NextApiHandler): NextApiHandler {
  return (req, res) => {
    if (req.method === "GET" || req.method === "HEAD") {
      return handler(req, res);
    }

    const contentType = readHeader(req, "content-type")?.split(";")[0]?.trim().toLowerCase();
    if (contentType !== "application/json") {
      return reject(res, 415, "mutations require Content-Type: application/json");
    }
    if (isCrossSite(req)) {
      return reject(res, 403, "cross-site request rejected");
    }
    return handler(req, res);
  };
}
