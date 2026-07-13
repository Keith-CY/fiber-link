import type { UserRole, WithdrawalPolicyRecord } from "@fiber-link/db";
import type { DashboardWithdrawalPolicy } from "./dashboard/dashboard-page-model";
import { type AdminScope, createDbAdminServices } from "./server/services";
import { type WithdrawalPolicyInput, parseWithdrawalPolicyInput } from "./withdrawal-policy-input";

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

/** Actor identity the CLI passes to the services seam (mirrors {@link AdminScope}). */
type WithdrawalPolicyActorContext = AdminScope;

type WithdrawalPolicyOpsDependencies = {
  listPolicies: (input: { ctx: WithdrawalPolicyActorContext }) => Promise<WithdrawalPolicyRecord[]>;
  upsertPolicy: (input: {
    ctx: WithdrawalPolicyActorContext;
    input: UpsertCommand["input"];
  }) => Promise<WithdrawalPolicyRecord>;
};

function toRecord(policy: DashboardWithdrawalPolicy): WithdrawalPolicyRecord {
  return {
    appId: policy.appId,
    allowedAssets: policy.allowedAssets,
    maxPerRequest: policy.maxPerRequest,
    perUserDailyMax: policy.perUserDailyMax,
    perAppDailyMax: policy.perAppDailyMax,
    cooldownSeconds: policy.cooldownSeconds,
    updatedBy: policy.updatedBy,
    createdAt: new Date(policy.createdAt),
    updatedAt: new Date(policy.updatedAt),
  };
}

function createDefaultDependencies(): WithdrawalPolicyOpsDependencies {
  // The CLI runs outside a request, so it talks to the real Postgres-backed
  // services directly (no fixture, no tRPC handler).
  const services = createDbAdminServices();
  return {
    listPolicies: async ({ ctx }) => (await services.listPolicies(ctx)).map(toRecord),
    upsertPolicy: async ({ ctx, input }) => toRecord(await services.upsertPolicy(ctx, input)),
  };
}

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
  deps: WithdrawalPolicyOpsDependencies = createDefaultDependencies(),
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
  const ctx: WithdrawalPolicyActorContext = {
    role: command.role,
    adminUserId: command.adminUserId,
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
