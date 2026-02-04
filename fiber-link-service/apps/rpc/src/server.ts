import Fastify from "fastify";
import { registerRpc } from "./rpc";

export function buildServer() {
  const app = Fastify({ logger: true });

  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    const rawBody = body as string;
    (req as { rawBody?: string }).rawBody = rawBody;
    try {
      done(null, JSON.parse(rawBody));
    } catch (error) {
      (error as Error & { statusCode?: number }).statusCode = 400;
      done(error as Error, undefined);
    }
  });

  registerRpc(app);
  return app;
}
