import type { NextApiRequest, NextApiResponse } from "next";
import { getDashboardFixtureDependencies } from "../../../server/dashboard-fixture-store";
import { handleDashboardBackupRestorePlanAction } from "../../../server/dashboard-backup-action";

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
  const result = await handleDashboardBackupRestorePlanAction(
    {
      roleHeader: readHeader(req.headers["x-admin-role"]),
      body: typeof req.body === "object" && req.body ? (req.body as Record<string, unknown>) : {},
    },
    fixtureDeps
      ? {
          env: process.env,
          listBackupBundles: fixtureDeps.listBackupBundles,
          buildBackupRestorePlan: fixtureDeps.buildBackupRestorePlan,
        }
      : {
          env: process.env,
        },
  );

  res.writeHead(result.statusCode, { Location: result.location });
  res.end();
}
