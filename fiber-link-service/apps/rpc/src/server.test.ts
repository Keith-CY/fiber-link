import { describe, expect, it } from "vitest";
import { buildServer, parseRpcServerConfig, parseTrustProxy } from "./server";

describe("parseTrustProxy", () => {
  it("defaults to false when unset or blank", () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy("   ")).toBe(false);
  });

  it("parses boolean tokens case-insensitively", () => {
    expect(parseTrustProxy("true")).toBe(true);
    expect(parseTrustProxy("YES")).toBe(true);
    expect(parseTrustProxy("on")).toBe(true);
    expect(parseTrustProxy("false")).toBe(false);
    expect(parseTrustProxy("No")).toBe(false);
    expect(parseTrustProxy("off")).toBe(false);
  });

  it("parses bare integers as hop counts", () => {
    expect(parseTrustProxy("1")).toBe(1);
    expect(parseTrustProxy("2")).toBe(2);
  });

  it("passes address/CIDR lists through verbatim", () => {
    expect(parseTrustProxy("127.0.0.1,10.0.0.0/8")).toBe("127.0.0.1,10.0.0.0/8");
  });
});

describe("parseRpcServerConfig", () => {
  it("applies defaults when the environment is empty", () => {
    expect(parseRpcServerConfig({})).toEqual({
      logLevel: "info",
      bodyLimitBytes: 262_144,
      requestTimeoutMs: 30_000,
      trustProxy: false,
    });
  });

  it("honors valid overrides", () => {
    expect(
      parseRpcServerConfig({
        RPC_LOG_LEVEL: "DEBUG",
        RPC_BODY_LIMIT_BYTES: "1024",
        RPC_REQUEST_TIMEOUT_MS: "5000",
        RPC_TRUST_PROXY: "true",
      }),
    ).toEqual({
      logLevel: "debug",
      bodyLimitBytes: 1024,
      requestTimeoutMs: 5000,
      trustProxy: true,
    });
  });

  it("falls back to defaults on invalid values", () => {
    expect(
      parseRpcServerConfig({
        RPC_LOG_LEVEL: "shout",
        RPC_BODY_LIMIT_BYTES: "-1",
        RPC_REQUEST_TIMEOUT_MS: "soon",
      }),
    ).toEqual({
      logLevel: "info",
      bodyLimitBytes: 262_144,
      requestTimeoutMs: 30_000,
      trustProxy: false,
    });
  });
});

describe("buildServer", () => {
  const testConfig = {
    logLevel: "silent",
    bodyLimitBytes: 1024,
    requestTimeoutMs: 5000,
    trustProxy: false as const,
  };

  it("wires config into fastify server options", () => {
    const app = buildServer(testConfig);
    expect(app.initialConfig.bodyLimit).toBe(1024);
    // requestTimeout is forwarded to the underlying Node server.
    expect(app.server.requestTimeout).toBe(5000);
    expect(app.log.level).toBe("silent");
  });

  it("rejects bodies over the configured limit with 413", async () => {
    const app = buildServer(testConfig);
    const oversized = JSON.stringify({
      jsonrpc: "2.0",
      id: "big",
      method: "health.ping",
      params: { pad: "x".repeat(2048) },
    });

    const res = await app.inject({
      method: "POST",
      url: "/rpc",
      headers: { "content-type": "application/json" },
      payload: oversized,
    });
    expect(res.statusCode).toBe(413);
  });

  it("honors x-forwarded-for only when trustProxy is enabled", async () => {
    const trusting = buildServer({ ...testConfig, trustProxy: true });
    trusting.get("/__test/ip", (req) => ({ ip: req.ip }));
    const trusted = await trusting.inject({
      method: "GET",
      url: "/__test/ip",
      headers: { "x-forwarded-for": "203.0.113.9" },
    });
    expect(trusted.json()).toEqual({ ip: "203.0.113.9" });

    const untrusting = buildServer(testConfig);
    untrusting.get("/__test/ip", (req) => ({ ip: req.ip }));
    const untrusted = await untrusting.inject({
      method: "GET",
      url: "/__test/ip",
      headers: { "x-forwarded-for": "203.0.113.9" },
    });
    expect(untrusted.json().ip).not.toBe("203.0.113.9");
  });

  it("still accepts normal-sized rpc requests", async () => {
    const app = buildServer(testConfig);
    const res = await app.inject({
      method: "POST",
      url: "/rpc",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ jsonrpc: "2.0", id: "1", method: "health.ping", params: {} }),
    });
    // Anything but a parser-level 413/400 proves the body passed the limit;
    // auth handling decides the actual status.
    expect(res.statusCode).not.toBe(413);
  });
});
