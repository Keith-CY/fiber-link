import { describe, expect, it } from "vitest";
import { RpcMethodError, rpcErrorResponse, rpcResultResponse } from "./rpc-error";

describe("rpc-error helpers", () => {
  it("builds RpcMethodError with code and optional data", () => {
    const error = new RpcMethodError(-32602, "invalid params", { field: "invoice" });
    expect(error.name).toBe("RpcMethodError");
    expect(error.message).toBe("invalid params");
    expect(error.code).toBe(-32602);
    expect(error.data).toEqual({ field: "invoice" });
  });

  it("builds JSON-RPC error responses with and without data", () => {
    expect(rpcErrorResponse(1, -32601, "Method not found")).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601, message: "Method not found" },
    });

    expect(rpcErrorResponse("req-1", -32602, "Invalid params", [{ path: ["amount"] }])).toEqual({
      jsonrpc: "2.0",
      id: "req-1",
      error: {
        code: -32602,
        message: "Invalid params",
        data: [{ path: ["amount"] }],
      },
    });
  });

  it("builds JSON-RPC success responses", () => {
    expect(rpcResultResponse("req-2", { status: "ok" })).toEqual({
      jsonrpc: "2.0",
      id: "req-2",
      result: { status: "ok" },
    });
  });
});
