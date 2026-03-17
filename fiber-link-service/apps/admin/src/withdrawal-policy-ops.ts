import { createDbClient, type Asset, type DbClient, type UserRole, type WithdrawalPolicyRecord } from "@fiber-link/db";
import { withdrawalPolicyRouter } from "./server/api/routers/withdrawal-policy";
import type { TrpcContext } from "./server/api/trpc";

type ListCommand = {
  action: "list";
  role: UserRole;
  adminUserId?: string;
};

type UpsertCommand = {
  action: "upsert";
  role: UserRole;
  adminUserId: string;
  input: {
    appId: string;
    allowedAssets: Asset[];
    maxPerRequest: string;
    perUserDailyMax: string;
    perAppDailyMax: string;
    cooldownSeconds: number;
  };
};

export type WithdrawalPolicyCommand = ListCommand | UpsertCommand;

type WithdrawalPolicyOpsDependencies = {
  createDb?: () => DbClient;
  listPolicies: (input: { ctx: TrpcContext }) => Promise<WithdrawalPolicyRecord[]>;
  upsertPolicy: (input: {
    ctx: TrpcContext;
    input: UpsertCommand["input"];
  }) => Promise<WithdrawalPolicyRecord>;
};

const DEFAULT_DEPENDENCIES: WithdrawalPolicyOpsDependencies = {
  createDb: () => createDbClient(),
  listPolicies: async ({ ctx }) => withdrawalPolicyRouter.createCaller(ctx).list(),
  upsertPolicy: async ({ ctx, input }) => withdrawalPolicyRouter.createCaller(ctx).upsert(input),
};

function parseRole(raw: string | undefined): UserRole {
  if (raw === "SUPER_ADMIN" || raw === "COMMUNITY_ADMIN") {
    return raw;
  }
  throw new Error("ADMIN_ROLE is required and must be SUPER_ADMIN or COMMUNITY_ADMIN");
}

function parseAssetList(raw: string | undefined): Asset[] {
  if (!raw) {
    throw new Error("--allowed-assets is required");
  }

  const assets = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is Asset => item === "CKB" || item === "USDI");
  if (assets.length === 0) {
    throw new Error("--allowed-assets must include CKB or USDI");
  }
  return Array.from(new Set(assets));
}

function getFlag(argv: string[], key: string): string | undefined {
  const prefix = `--${key}=`;
  const match = argv.find((token) => token.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function requireNonEmpty(raw: string | undefined, key: string): string {
  const value = raw?.trim();
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function parseCooldown(raw: string | undefined): number {
  const value = Number(requireNonEmpty(raw, "--cooldown-seconds"));
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("--cooldown-seconds must be an integer >= 0");
  }
  return value;
}

export function parseWithdrawalPolicyCommand(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): WithdrawalPolicyCommand {
  const action = argv[0];
  const role = parseRole(getFlag(argv, "role") ?? env.ADMIN_ROLE);
  const adminUserId = (getFlag(argv, "admin-user-id") ?? env.ADMIN_USER_ID)?.trim() || undefined;

  if (action === "list") {
    return {
      action,
      role,
      adminUserId,
    };
  }

  if (action === "upsert") {
    if (!adminUserId) {
      throw new Error("ADMIN_USER_ID is required for upsert");
    }

    return {
      action,
      role,
      adminUserId,
      input: {
        appId: requireNonEmpty(getFlag(argv, "app-id"), "--app-id"),
        allowedAssets: parseAssetList(getFlag(argv, "allowed-assets")),
        maxPerRequest: requireNonEmpty(getFlag(argv, "max-per-request"), "--max-per-request"),
        perUserDailyMax: requireNonEmpty(getFlag(argv, "per-user-daily-max"), "--per-user-daily-max"),
        perAppDailyMax: requireNonEmpty(getFlag(argv, "per-app-daily-max"), "--per-app-daily-max"),
        cooldownSeconds: parseCooldown(getFlag(argv, "cooldown-seconds")),
      },
    };
  }

  throw new Error("first argument must be list or upsert");
}

export async function runWithdrawalPolicyCommand(
  command: WithdrawalPolicyCommand,
  deps: WithdrawalPolicyOpsDependencies = DEFAULT_DEPENDENCIES,
): Promise<
  | {
      action: "list";
      generatedAt: string;
      actor: { role: UserRole; adminUserId: string | null };
      policies: WithdrawalPolicyRecord[];
    }
  | {
      action: "upsert";
      generatedAt: string;
      actor: { role: UserRole; adminUserId: string | null };
      policy: WithdrawalPolicyRecord;
    }
> {
  const ctx: TrpcContext = {
    role: command.role,
    adminUserId: command.adminUserId,
    db: deps.createDb ? deps.createDb() : undefined,
  };
  const actor = {
    role: command.role,
    adminUserId: command.adminUserId ?? null,
  };
  const generatedAt = new Date().toISOString();

  if (command.action === "list") {
    return {
      action: "list",
      generatedAt,
      actor,
      policies: await deps.listPolicies({ ctx }),
    };
  }

  return {
    action: "upsert",
    generatedAt,
    actor,
    policy: await deps.upsertPolicy({
      ctx,
      input: command.input,
    }),
  };
}
