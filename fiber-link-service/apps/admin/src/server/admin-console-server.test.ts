import { afterEach, describe, expect, it } from "vitest";
import type { DbClient, WithdrawalState, type UserRole, type WithdrawalPolicyRecord } from "@fiber-link/db";
import { buildAdminConsoleServer, type AdminConsoleDependencies } from "./admin-console-server";

type AppRow = {
  appId: string;
  createdAt: string;
};

type WithdrawalRow = {
  id: string;
  appId: string;
  userId: string;
  asset: "CKB" | "USDI";
  amount: string;
  state: WithdrawalState;
  createdAt: string;
  txHash: string | null;
};

type PolicySeed = Omit<WithdrawalPolicyRecord, "createdAt" | "updatedAt"> & {
  createdAt?: Date;
  updatedAt?: Date;
};

function createPolicyRecord(overrides: PolicySeed): WithdrawalPolicyRecord {
  return {
    appId: overrides.appId,
    allowedAssets: overrides.allowedAssets,
    maxPerRequest: overrides.maxPerRequest,
    perUserDailyMax: overrides.perUserDailyMax,
    perAppDailyMax: overrides.perAppDailyMax,
    cooldownSeconds: overrides.cooldownSeconds,
    updatedBy: overrides.updatedBy ?? null,
    createdAt: overrides.createdAt ?? new Date("2026-03-18T00:00:00.000Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-03-18T00:00:00.000Z"),
  };
}

function createDeps(input?: {
  apps?: AppRow[];
  withdrawals?: WithdrawalRow[];
  policies?: PolicySeed[];
}) {
  const store = {
    apps: input?.apps ?? [
      { appId: "app-alpha", createdAt: "2026-03-18T00:00:00.000Z" },
      { appId: "app-beta", createdAt: "2026-03-18T00:00:00.000Z" },
    ],
    withdrawals: input?.withdrawals ?? [],
    policies: new Map(
      (input?.policies ?? [
        {
          appId: "app-alpha",
          allowedAssets: ["CKB", "USDI"],
          maxPerRequest: "5000",
          perUserDailyMax: "20000",
          perAppDailyMax: "200000",
          cooldownSeconds: 120,
          updatedBy: "admin-1",
        },
      ]).map((policy) => [policy.appId, createPolicyRecord(policy)]),
    ),
  };

  const sharedDb = {} as DbClient;
  const deps: AdminConsoleDependencies = {
    createDb: () => sharedDb,
    listApps: async () => store.apps,
    listWithdrawals: async () => store.withdrawals,
    listPolicies: async (ctx) => {
      if (ctx.role === "COMMUNITY_ADMIN") {
        return Array.from(store.policies.values())
          .filter((policy) => policy.appId === "app-alpha")
          .map((policy) => ({
            ...policy,
            createdAt: policy.createdAt.toISOString(),
            updatedAt: policy.updatedAt.toISOString(),
          }));
      }
      return Array.from(store.policies.values()).map((policy) => ({
        ...policy,
        createdAt: policy.createdAt.toISOString(),
        updatedAt: policy.updatedAt.toISOString(),
      }));
    },
    upsertPolicy: async ({ ctx, input }) => {
      if (ctx.role === "COMMUNITY_ADMIN" && input.appId !== "app-alpha") {
        throw new Error("COMMUNITY_ADMIN can only update policies for managed apps");
      }
      const next = createPolicyRecord({
        appId: input.appId,
        allowedAssets: input.allowedAssets,
        maxPerRequest: input.maxPerRequest,
        perUserDailyMax: input.perUserDailyMax,
        perAppDailyMax: input.perAppDailyMax,
        cooldownSeconds: input.cooldownSeconds,
        updatedBy: ctx.adminUserId ?? null,
      });
      store.policies.set(input.appId, next);
      return next;
    },
  };

  return { deps, store };
}

const servers = new Set<Awaited<ReturnType<typeof buildAdminConsoleServer>>>();

afterEach(async () => {
  await Promise.all(
    Array.from(servers).map(async (server) => {
      await server.close();
      servers.delete(server);
    }),
  );
});

async function createServer(role: UserRole = "SUPER_ADMIN") {
  const fixture = createDeps();
  const server = await buildAdminConsoleServer({
    deps: fixture.deps,
    defaultRole: role,
    defaultAdminUserId: "admin-ui-e2e",
  });
  servers.add(server);
  return {
    server,
    store: fixture.store,
  };
}

describe("admin console server", () => {
  it("renders editable admin controls for managed apps", async () => {
    const { server } = await createServer();

    const response = await server.inject({
      method: "GET",
      url: "/?role=SUPER_ADMIN&adminUserId=admin-ui-e2e",
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Admin controls");
    expect(response.body).toContain("Supported assets");
    expect(response.body).toContain("Per-request max");
    expect(response.body).toContain("Save policy");
    expect(response.body).toContain("app-alpha");
    expect(response.body).toContain("app-beta");
  });

  it("persists a valid policy update and redirects back with a success banner", async () => {
    const { server, store } = await createServer();

    const submit = await server.inject({
      method: "POST",
      url: "/policies",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: new URLSearchParams({
        role: "SUPER_ADMIN",
        adminUserId: "admin-ui-e2e",
        appId: "app-beta",
        allowedAssets: "USDI",
        maxPerRequest: "1500",
        perUserDailyMax: "4500",
        perAppDailyMax: "25000",
        cooldownSeconds: "45",
      }).toString(),
    });

    expect(submit.statusCode).toBe(303);
    expect(submit.headers.location).toContain("saved=app-beta");

    const redirected = await server.inject({
      method: "GET",
      url: String(submit.headers.location),
    });

    expect(redirected.statusCode).toBe(200);
    expect(redirected.body).toContain("Policy saved for app-beta");
    expect(redirected.body).toContain("value=\"1500\"");
    expect(store.policies.get("app-beta")).toMatchObject({
      appId: "app-beta",
      maxPerRequest: "1500",
      perUserDailyMax: "4500",
      perAppDailyMax: "25000",
      cooldownSeconds: 45,
      updatedBy: "admin-ui-e2e",
    });
  });

  it("re-renders the page with validation feedback and preserves operator input", async () => {
    const { server } = await createServer();

    const response = await server.inject({
      method: "POST",
      url: "/policies",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: new URLSearchParams({
        role: "SUPER_ADMIN",
        adminUserId: "admin-ui-e2e",
        appId: "app-beta",
        allowedAssets: "CKB,USDI",
        maxPerRequest: "9000",
        perUserDailyMax: "4000",
        perAppDailyMax: "25000",
        cooldownSeconds: "45",
      }).toString(),
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain("maxPerRequest must be &lt;= perUserDailyMax");
    expect(response.body).toContain("value=\"9000\"");
    expect(response.body).toContain("value=\"4000\"");
    expect(response.body).toContain("app-beta");
  });
});
