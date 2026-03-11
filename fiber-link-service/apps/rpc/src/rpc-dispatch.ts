import type { FastifyReply, FastifyRequest } from "fastify";
import type { ZodType } from "zod";
import { RpcErrorCode, type RpcId } from "./contracts";
import { rpcErrorResponse, rpcResultResponse } from "./rpc-error";

export type ErrorMapEntry = {
  match: (e: Error) => boolean;
  code: RpcErrorCode;
  message: string | ((e: Error) => string);
};

export type MethodDef<P, R> = {
  paramsSchema: ZodType<P>;
  resultSchema: ZodType<R>;
  handler: (params: P, ctx: { appId: string }) => Promise<R>;
  errorMap?: ErrorMapEntry[];
  methodLabel: string;
};

export async function dispatchMethod<P, R>(
  def: MethodDef<P, R>,
  rpcId: RpcId,
  rawParams: unknown,
  appId: string,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const parsed = def.paramsSchema.safeParse(rawParams);
  if (!parsed.success) {
    reply.send(
      rpcErrorResponse(rpcId, RpcErrorCode.INVALID_PARAMS, "Invalid params", parsed.error.issues),
    );
    return;
  }
  try {
    const result = await def.handler(parsed.data, { appId });
    const validated = def.resultSchema.safeParse(result);
    if (!validated.success) {
      req.log.error(validated.error, `${def.methodLabel} produced invalid response payload`);
      reply.send(rpcErrorResponse(rpcId, RpcErrorCode.INTERNAL_ERROR, "Internal error"));
      return;
    }
    reply.send(rpcResultResponse(rpcId, validated.data));
  } catch (error) {
    if (error instanceof Error && def.errorMap) {
      for (const entry of def.errorMap) {
        if (entry.match(error)) {
          const msg = typeof entry.message === "function" ? entry.message(error) : entry.message;
          reply.send(rpcErrorResponse(rpcId, entry.code, msg));
          return;
        }
      }
    }
    req.log.error(error);
    reply.send(rpcErrorResponse(rpcId, RpcErrorCode.INTERNAL_ERROR, "Internal error"));
  }
}
