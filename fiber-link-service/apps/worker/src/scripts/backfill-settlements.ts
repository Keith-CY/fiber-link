import { createAdapter } from "@fiber-link/fiber-adapter";
import { runSettlementDiscovery } from "../settlement-discovery";

type BackfillArgs = {
  appId?: string;
  from?: Date;
  to?: Date;
  limit: number;
};

function parseDateFlag(value: string, key: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${key}: ${value}`);
  }
  return date;
}

function parseArgs(argv: string[]): BackfillArgs {
  const args: BackfillArgs = { limit: 500 };

  for (const token of argv) {
    if (token.startsWith("--app-id=")) {
      args.appId = token.slice("--app-id=".length);
      continue;
    }
    if (token.startsWith("--from=")) {
      args.from = parseDateFlag(token.slice("--from=".length), "--from");
      continue;
    }
    if (token.startsWith("--to=")) {
      args.to = parseDateFlag(token.slice("--to=".length), "--to");
      continue;
    }
    if (token.startsWith("--limit=")) {
      const value = Number(token.slice("--limit=".length));
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`Invalid --limit: ${token.slice("--limit=".length)}`);
      }
      args.limit = value;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (args.from && args.to && args.from > args.to) {
    throw new Error("--from must be <= --to");
  }

  return args;
}

async function main() {
  const endpoint = process.env.FIBER_RPC_URL;
  if (!endpoint) {
    throw new Error("FIBER_RPC_URL is required");
  }

  const { appId, from, to, limit } = parseArgs(process.argv.slice(2));
  const adapter = createAdapter({ endpoint });

  const summary = await runSettlementDiscovery({
    limit,
    appId,
    createdAtFrom: from,
    createdAtTo: to,
    adapter,
  });

  console.log(
    JSON.stringify(
      {
        ok: summary.errors === 0,
        appId: appId ?? null,
        from: from?.toISOString() ?? null,
        to: to?.toISOString() ?? null,
        limit,
        summary,
      },
      null,
      2,
    ),
  );

  if (summary.errors > 0) {
    process.exitCode = 2;
  }
}

void main().catch((error) => {
  console.error("backfill-settlements failed", error);
  process.exit(1);
});
