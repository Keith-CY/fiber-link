import { createDbClient, type DbClient, type UserRole, type WithdrawalPolicyRecord } from "@fiber-link/db";
import { withdrawalPolicyRouter } from "./server/api/routers/withdrawal-policy";
import type { TrpcContext } from "./server/api/trpc";
import { parseWithdrawalPolicyInput, type WithdrawalPolicyInput } from "./withdrawal-policy-input";

type ListCommand = {
  action: "list";
  role: UserRole;
  adminUserId?: string;
};

type UpsertCommand = {
  action: "upsert";
  role: UserRole;
  adminUserId: string;
  input: WithdrawalPolicyInput;
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

function getFlag(argv: string[], key: string): string | undefined {
  const prefix = `--${key}=`;
  const match = argv.find((token) => token.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
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
      input: parseWithdrawalPolicyInput({
        appId: getFlag(argv, "app-id"),
        allowedAssets: getFlag(argv, "allowed-assets"),
        maxPerRequest: getFlag(argv, "max-per-request"),
        perUserDailyMax: getFlag(argv, "per-user-daily-max"),
        perAppDailyMax: getFlag(argv, "per-app-daily-max"),
        cooldownSeconds: getFlag(argv, "cooldown-seconds"),
      }),
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
