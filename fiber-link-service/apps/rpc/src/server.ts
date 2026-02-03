import Fastify from "fastify";
import { registerRpc } from "./rpc";

export function buildServer() {
  const app = Fastify({ logger: true });
  registerRpc(app);
  return app;
}
