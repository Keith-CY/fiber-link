import http from "node:http";
import type { AddressInfo } from "node:net";
import type { NextApiRequest, NextApiResponse } from "next";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../../pages/api/trpc/[trpc]";
import type { createTrpcContext as CreateTrpcContext } from "./context";

const { captureBackup } = vi.hoisted(() => ({
  captureBackup: vi.fn(async () => ({ backupId: "b-1", backupDir: "/tmp/b-1", archiveFile: "/tmp/b-1.tar.gz" })),
}));

// Keep the real context resolution (proxy headers / dev env fallback) and only
// swap the backup side effect for a spy so a test can assert it never ran.
vi.mock("./context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./context")>();
  const createTrpcContext: typeof CreateTrpcContext = (opts) => {
    const ctx = actual.createTrpcContext(opts);
    return { ...ctx, services: { ...ctx.services, captureBackup } };
  };
  return { createTrpcContext };
});

const ORIGINAL = { ...process.env };
let server: http.Server;
let baseUrl: string;

// Mimics the Next.js pages-router API resolver: the dynamic segment lands on
// `req.query.trpc` and the default body parser turns JSON into an object (an
// empty body becomes `{}`) and every other content type into a raw string.
async function nextLikeHandler(req: http.IncomingMessage, res: http.ServerResponse) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  const url = new URL(req.url ?? "/", "http://localhost");
  const contentType = req.headers["content-type"] ?? "";
  const nextReq = req as NextApiRequest;
  nextReq.query = {
    ...Object.fromEntries(url.searchParams),
    trpc: url.pathname.replace(/^\/api\/trpc\//, ""),
  };
  nextReq.body = contentType.startsWith("application/json") ? (raw ? JSON.parse(raw) : {}) : raw;
  await handler(nextReq, res as NextApiResponse);
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    void nextLikeHandler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  // Non-production console with the dev env fallback: a header-less request
  // resolves to SUPER_ADMIN, exactly the case a cross-site form can abuse.
  process.env.ADMIN_DASHBOARD_FIXTURE_PATH = "fixtures/dashboard-proof.json";
  process.env.ADMIN_DASHBOARD_DEFAULT_ROLE = "SUPER_ADMIN";
  captureBackup.mockClear();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

function postCapture(headers: Record<string, string>, body?: BodyInit) {
  return fetch(`${baseUrl}/api/trpc/ops.captureBackup`, { method: "POST", headers, body });
}

function multipartBody(): FormData {
  const form = new FormData();
  form.append("note", "cross-site");
  return form;
}

describe("tRPC API handler request guard", () => {
  it("rejects a multipart/form-data mutation without running it", async () => {
    const res = await postCapture({}, multipartBody());
    expect(res.status).toBe(415);
    expect(captureBackup).not.toHaveBeenCalled();
  });

  it("rejects an application/octet-stream mutation without running it", async () => {
    const res = await postCapture({ "content-type": "application/octet-stream" }, "x");
    expect(res.status).toBe(415);
    expect(captureBackup).not.toHaveBeenCalled();
  });

  it("rejects a JSON mutation whose Origin does not match the host", async () => {
    const res = await postCapture({ "content-type": "application/json", origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(captureBackup).not.toHaveBeenCalled();
  });

  it("rejects a JSON mutation the browser marks as cross-site", async () => {
    const res = await postCapture({ "content-type": "application/json", "sec-fetch-site": "cross-site" });
    expect(res.status).toBe(403);
    expect(captureBackup).not.toHaveBeenCalled();
  });

  it("rejects a JSON mutation the browser marks as same-site (sibling subdomain)", async () => {
    const res = await postCapture({ "content-type": "application/json", "sec-fetch-site": "same-site" });
    expect(res.status).toBe(403);
    expect(captureBackup).not.toHaveBeenCalled();
  });

  it("rejects a JSON mutation from the opaque null origin", async () => {
    const res = await postCapture({ "content-type": "application/json", origin: "null" });
    expect(res.status).toBe(403);
    expect(captureBackup).not.toHaveBeenCalled();
  });

  it("runs a same-origin JSON mutation like the console's own tRPC client sends", async () => {
    // fetch sets Host to the server address, so Origin matches it.
    const res = await postCapture({ "content-type": "application/json", origin: baseUrl });
    expect(res.status).toBe(200);
    expect(captureBackup).toHaveBeenCalledTimes(1);
  });

  it("trusts Sec-Fetch-Site over a proxy-rewritten Host", async () => {
    const res = await postCapture({
      "content-type": "application/json; charset=utf-8",
      origin: "https://admin.example",
      "sec-fetch-site": "same-origin",
    });
    expect(res.status).toBe(200);
    expect(captureBackup).toHaveBeenCalledTimes(1);
  });

  it("matches Origin against X-Forwarded-Host when the proxy rewrites Host", async () => {
    const res = await postCapture({
      "content-type": "application/json",
      origin: "https://admin.example",
      "x-forwarded-host": "admin.example",
    });
    expect(res.status).toBe(200);
    expect(captureBackup).toHaveBeenCalledTimes(1);
  });

  it("runs a JSON mutation without Origin (curl / server-side callers)", async () => {
    const res = await postCapture({ "content-type": "application/json" });
    expect(res.status).toBe(200);
    expect(captureBackup).toHaveBeenCalledTimes(1);
  });

  it("leaves GET queries unaffected", async () => {
    const res = await fetch(`${baseUrl}/api/trpc/ops.listBackups`, { headers: { "sec-fetch-site": "cross-site" } });
    expect(res.status).toBe(200);
  });
});
