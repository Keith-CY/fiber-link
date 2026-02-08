import { createDbClient } from "@fiber-link/db";
import { createDbAppRepo } from "../repositories/app-repo";
import { loadSecretMap } from "../secret-map";

type Summary = {
  total: number;
  dryRun: boolean;
  missing: string[];
  updates: string[];
  unchanged: string[];
  applied: string[];
};

async function main() {
  const dryRun = process.argv.includes("--dry-run") || !process.argv.includes("--apply");
  const secretMap = loadSecretMap() ?? {};
  const entries = Object.entries(secretMap);

  const summary: Summary = {
    total: entries.length,
    dryRun,
    missing: [],
    updates: [],
    unchanged: [],
    applied: [],
  };

  if (entries.length === 0) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const appRepo = createDbAppRepo(createDbClient());
  for (const [appId, hmacSecret] of entries) {
    const existing = await appRepo.findByAppId(appId);
    if (!existing) {
      summary.missing.push(appId);
      if (!dryRun) {
        await appRepo.upsert({ appId, hmacSecret });
        summary.applied.push(appId);
      }
      continue;
    }

    if (existing.hmacSecret !== hmacSecret) {
      summary.updates.push(appId);
      if (!dryRun) {
        await appRepo.upsert({ appId, hmacSecret });
        summary.applied.push(appId);
      }
      continue;
    }

    summary.unchanged.push(appId);
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error("backfill-app-secrets failed", error);
  process.exit(1);
});
