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
    const isMissing = !existing;
    const isOutdated = !isMissing && existing.hmacSecret !== hmacSecret;

    if (isMissing) {
      summary.missing.push(appId);
    } else if (isOutdated) {
      summary.updates.push(appId);
    } else {
      summary.unchanged.push(appId);
      continue;
    }

    if (!dryRun) {
      await appRepo.upsert({ appId, hmacSecret });
      summary.applied.push(appId);
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error("backfill-app-secrets failed", error);
  process.exit(1);
});
