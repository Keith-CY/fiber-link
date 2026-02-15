import { type RpcErrorCode, type RpcId } from "./contracts";

export class RpcMethodError extends Error {
  constructor(
    public readonly code: RpcErrorCode,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "RpcMethodError";
  }
}

export function rpcErrorResponse(id: RpcId, code: RpcErrorCode, message: string, data?: unknown) {
  return {
    jsonrpc: "2.0" as const,
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

export function rpcResultResponse<T>(id: RpcId, result: T) {
  return {
    jsonrpc: "2.0" as const,
    id,
    result,
  };
}
