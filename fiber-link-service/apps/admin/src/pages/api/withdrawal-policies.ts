import type { NextApiRequest, NextApiResponse } from "next";
import { withdrawalPolicyRouter } from "../../server/api/routers/withdrawal-policy";
import { getDashboardFixtureDependencies } from "../../server/dashboard-fixture-store";
import { handleDashboardPolicyAction } from "../../server/dashboard-policy-action";

function readHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).end("Method Not Allowed");
    return;
  }

  const fixtureDeps = getDashboardFixtureDependencies(process.env);
  const result = await handleDashboardPolicyAction(
    {
      roleHeader: readHeader(req.headers["x-admin-role"]),
      adminUserIdHeader: readHeader(req.headers["x-admin-user-id"]),
      body: typeof req.body === "object" && req.body ? (req.body as Record<string, unknown>) : {},
    },
    fixtureDeps
      ? {
          createDb: fixtureDeps.createDb,
          upsertPolicy: fixtureDeps.upsertPolicy,
          env: process.env,
        }
      : {
          upsertPolicy: async ({ ctx, input }) => withdrawalPolicyRouter.createCaller(ctx).upsert(input),
          env: process.env,
        },
  );

  res.writeHead(result.statusCode, { Location: result.location });
  res.end();
}
