import Fastify from "fastify";
import formbody from "@fastify/formbody";
import { createDbClient, type DbClient, type UserRole } from "@fiber-link/db";
import { parseWithdrawalPolicyInput, type WithdrawalPolicyInput } from "../withdrawal-policy-input";
import {
  DASHBOARD_TITLE,
  loadDashboardState,
  type DashboardDataDependencies,
  type DashboardPageState,
  type DashboardWithdrawalPolicy,
} from "../pages/dashboard-data";
import { appRouter } from "./api/routers/app";
import { withdrawalPolicyRouter } from "./api/routers/withdrawal-policy";
import { withdrawalRouter } from "./api/routers/withdrawal";
import type { TrpcContext } from "./api/trpc";

type HeaderValue = string | string[] | undefined;

type RequestInput = {
  role?: unknown;
  adminUserId?: unknown;
};

type PolicyDraft = {
  appId: string;
  allowedAssets: Array<"CKB" | "USDI">;
  maxPerRequest: string;
  perUserDailyMax: string;
  perAppDailyMax: string;
  cooldownSeconds: string;
};

export type DashboardRequestContext = {
  role: UserRole;
  adminUserId?: string;
};

export type AdminConsoleDependencies = DashboardDataDependencies & {
  upsertPolicy: (input: {
    ctx: TrpcContext;
    input: WithdrawalPolicyInput;
  }) => Promise<unknown>;
};

type BuildAdminConsoleServerOptions = {
  deps?: AdminConsoleDependencies;
  defaultRole?: UserRole;
  defaultAdminUserId?: string;
};

const DEFAULT_DEPENDENCIES: AdminConsoleDependencies = {
  createDb: () => createDbClient(),
  listApps: async (ctx) => {
    const rows = await appRouter.createCaller(ctx).list();
    return rows.map((row) => ({
      appId: row.appId,
      createdAt: row.createdAt.toISOString(),
    }));
  },
  listWithdrawals: async (ctx) => {
    const rows = await withdrawalRouter.createCaller(ctx).list();
    return rows.map((row) => ({
      id: row.id,
      appId: row.appId,
      userId: row.userId,
      asset: row.asset,
      amount: row.amount,
      state: row.state,
      createdAt: row.createdAt.toISOString(),
      txHash: row.txHash ?? null,
    }));
  },
  listPolicies: async (ctx) => {
    const rows = await withdrawalPolicyRouter.createCaller(ctx).list();
    return rows.map((row) => ({
      appId: row.appId,
      allowedAssets: row.allowedAssets,
      maxPerRequest: row.maxPerRequest,
      perUserDailyMax: row.perUserDailyMax,
      perAppDailyMax: row.perAppDailyMax,
      cooldownSeconds: row.cooldownSeconds,
      updatedBy: row.updatedBy ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  },
  upsertPolicy: async ({ ctx, input }) => withdrawalPolicyRouter.createCaller(ctx).upsert(input),
};

export async function buildAdminConsoleServer(options: BuildAdminConsoleServerOptions = {}) {
  const app = Fastify({
    logger: false,
  });
  await app.register(formbody);

  app.get("/healthz", async () => ({ status: "ok" as const }));

  app.get("/", async (request, reply) => {
    const context = resolveRequestContext(request.query as Record<string, unknown>, request.headers, options);
    const state = await loadState(context, options.deps);
    const savedAppId = getTextValue((request.query as Record<string, unknown>).saved);

    return reply.type("text/html; charset=utf-8").send(
      renderAdminConsolePage({
        state,
        context,
        savedAppId,
      }),
    );
  });

  app.post("/policies", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const context = resolveRequestContext(
      {
        role: body.role,
        adminUserId: body.adminUserId,
      },
      request.headers,
      options,
    );
    const draft = toPolicyDraft(body);
    const deps = options.deps ?? DEFAULT_DEPENDENCIES;

    try {
      const input = parseWithdrawalPolicyInput({
        appId: body.appId,
        allowedAssets: body.allowedAssets,
        maxPerRequest: body.maxPerRequest,
        perUserDailyMax: body.perUserDailyMax,
        perAppDailyMax: body.perAppDailyMax,
        cooldownSeconds: body.cooldownSeconds,
      });

      await deps.upsertPolicy({
        ctx: toTrpcContext(context, deps.createDb()),
        input,
      });

      const params = new URLSearchParams({
        role: context.role,
        saved: input.appId,
      });
      if (context.adminUserId) {
        params.set("adminUserId", context.adminUserId);
      }

      return reply.redirect(`/?${params.toString()}`, 303);
    } catch (error) {
      const state = await loadState(context, deps);
      return reply
        .code(400)
        .type("text/html; charset=utf-8")
        .send(
          renderAdminConsolePage({
            state,
            context,
            formError: getErrorMessage(error),
            draft,
          }),
        );
    }
  });

  await app.ready();
  return app;
}

async function loadState(context: DashboardRequestContext, deps?: DashboardDataDependencies): Promise<DashboardPageState> {
  return loadDashboardState(
    {
      roleHeader: context.role,
      adminUserIdHeader: context.adminUserId,
    },
    deps ?? DEFAULT_DEPENDENCIES,
  );
}

function toTrpcContext(context: DashboardRequestContext, db: DbClient): TrpcContext {
  return {
    role: context.role,
    adminUserId: context.adminUserId,
    db,
  };
}

function resolveRequestContext(
  input: RequestInput,
  headers: Record<string, HeaderValue>,
  options: BuildAdminConsoleServerOptions,
): DashboardRequestContext {
  const role = parseRole(
    getTextValue(input.role) ??
      getHeader(headers, "x-admin-role") ??
      options.defaultRole ??
      "SUPER_ADMIN",
  );
  const adminUserId =
    getTextValue(input.adminUserId) ??
    getHeader(headers, "x-admin-user-id") ??
    options.defaultAdminUserId;

  return {
    role,
    adminUserId: adminUserId?.trim() || undefined,
  };
}

function parseRole(raw: string): UserRole {
  if (raw === "SUPER_ADMIN" || raw === "COMMUNITY_ADMIN") {
    return raw;
  }
  return "SUPER_ADMIN";
}

function getHeader(headers: Record<string, HeaderValue>, key: string): string | undefined {
  const value = headers[key];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function getTextValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }
  return typeof value === "string" ? value : undefined;
}

function getStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string" && value.trim() !== "") {
    return value.split(",").map((item) => item.trim());
  }
  return [];
}

function toPolicyDraft(body: Record<string, unknown>): PolicyDraft {
  return {
    appId: getTextValue(body.appId) ?? "",
    allowedAssets: getStringArray(body.allowedAssets).filter(
      (value): value is "CKB" | "USDI" => value === "CKB" || value === "USDI",
    ),
    maxPerRequest: getTextValue(body.maxPerRequest) ?? "",
    perUserDailyMax: getTextValue(body.perUserDailyMax) ?? "",
    perAppDailyMax: getTextValue(body.perAppDailyMax) ?? "",
    cooldownSeconds: getTextValue(body.cooldownSeconds) ?? "0",
  };
}

function renderAdminConsolePage(input: {
  state: DashboardPageState;
  context: DashboardRequestContext;
  savedAppId?: string;
  formError?: string;
  draft?: PolicyDraft;
}): string {
  const title = DASHBOARD_TITLE;
  const pageBody =
    input.state.status === "ready"
      ? renderReadyState(input.state, input.context, input.savedAppId, input.formError, input.draft)
      : renderErrorState(input.state, input.formError);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        --bg: #f4efe8;
        --panel: #fffaf2;
        --panel-strong: #102018;
        --ink: #17211d;
        --muted: #536257;
        --accent: #c65d2e;
        --accent-soft: #f4d8c9;
        --success: #1d6f42;
        --success-soft: #d9f2e3;
        --danger: #9f2f2f;
        --danger-soft: #f9dbdb;
        --line: rgba(23, 33, 29, 0.12);
        --shadow: 0 28px 80px rgba(47, 38, 24, 0.14);
        --radius-lg: 28px;
        --radius-md: 18px;
        --radius-sm: 12px;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(198, 93, 46, 0.16), transparent 30%),
          radial-gradient(circle at top right, rgba(16, 32, 24, 0.12), transparent 24%),
          linear-gradient(180deg, #fbf7f1 0%, var(--bg) 100%);
      }
      main {
        width: min(1200px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 36px 0 56px;
      }
      .hero, .panel, .policy-card {
        background: var(--panel);
        border: 1px solid var(--line);
        box-shadow: var(--shadow);
      }
      .hero {
        border-radius: var(--radius-lg);
        padding: 28px;
        display: grid;
        gap: 20px;
      }
      .hero-top {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: flex-start;
        flex-wrap: wrap;
      }
      .eyebrow {
        margin: 0 0 10px;
        font-size: 12px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--muted);
      }
      h1 {
        margin: 0;
        font-size: clamp(34px, 5vw, 52px);
        line-height: 0.95;
      }
      .subtitle {
        margin: 10px 0 0;
        color: var(--muted);
        max-width: 760px;
        line-height: 1.5;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border-radius: 999px;
        padding: 10px 14px;
        font-size: 13px;
        font-weight: 700;
        background: rgba(16, 32, 24, 0.06);
      }
      .grid {
        display: grid;
        gap: 18px;
      }
      .stats {
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      }
      .stat {
        border-radius: var(--radius-md);
        padding: 16px;
        background: rgba(16, 32, 24, 0.04);
      }
      .stat-label {
        display: block;
        font-size: 12px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .stat-value {
        display: block;
        margin-top: 10px;
        font-size: 32px;
        font-weight: 800;
      }
      .section-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 12px;
        margin: 36px 0 14px;
      }
      .section-header h2 {
        margin: 0;
        font-size: 28px;
      }
      .section-header p {
        margin: 0;
        color: var(--muted);
      }
      .feedback {
        border-radius: var(--radius-md);
        padding: 14px 16px;
        font-weight: 600;
      }
      .feedback.success {
        background: var(--success-soft);
        color: var(--success);
      }
      .feedback.error {
        background: var(--danger-soft);
        color: var(--danger);
      }
      .policy-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 18px;
      }
      .policy-card {
        border-radius: 24px;
        padding: 22px;
      }
      .policy-card h3 {
        margin: 0;
        font-size: 22px;
      }
      .policy-card p {
        margin: 8px 0 0;
        color: var(--muted);
      }
      .card-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 14px;
      }
      .chip {
        border-radius: 999px;
        padding: 6px 10px;
        background: var(--accent-soft);
        color: var(--accent);
        font-size: 12px;
        font-weight: 700;
      }
      form {
        margin-top: 18px;
        display: grid;
        gap: 16px;
      }
      .field-grid {
        display: grid;
        gap: 14px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .field {
        display: grid;
        gap: 8px;
      }
      .field.full {
        grid-column: 1 / -1;
      }
      label {
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.02em;
      }
      input[type="text"],
      input[type="number"] {
        width: 100%;
        border: 1px solid rgba(23, 33, 29, 0.14);
        border-radius: var(--radius-sm);
        padding: 12px 14px;
        background: #fffdf9;
        color: var(--ink);
        font: inherit;
      }
      .checkboxes {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .checkboxes label {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border: 1px solid rgba(23, 33, 29, 0.14);
        border-radius: 999px;
        padding: 10px 14px;
        background: #fffdf9;
      }
      button {
        appearance: none;
        border: 0;
        border-radius: 999px;
        padding: 12px 18px;
        font: inherit;
        font-weight: 800;
        color: white;
        background: linear-gradient(135deg, #c65d2e, #a33e18);
        cursor: pointer;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        background: var(--panel);
        border-radius: var(--radius-md);
        overflow: hidden;
      }
      th, td {
        text-align: left;
        padding: 12px 14px;
        border-bottom: 1px solid var(--line);
      }
      th {
        font-size: 12px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .panel {
        border-radius: var(--radius-lg);
        padding: 20px;
      }
      .empty {
        color: var(--muted);
      }
      @media (max-width: 720px) {
        main { width: min(100vw - 20px, 100%); padding-top: 20px; }
        .field-grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main>${pageBody}</main>
  </body>
</html>`;
}

function renderErrorState(state: Exclude<DashboardPageState, { status: "ready" }>, formError?: string): string {
  const message = formError ?? (state.status === "error" ? state.message : "Loading dashboard data...");
  return `
    <section class="hero">
      <p class="eyebrow">Fiber Link</p>
      <h1>${escapeHtml(DASHBOARD_TITLE)}</h1>
      <div class="feedback error" role="alert">${escapeHtml(message)}</div>
    </section>
  `;
}

function renderReadyState(
  state: Extract<DashboardPageState, { status: "ready" }>,
  context: DashboardRequestContext,
  savedAppId?: string,
  formError?: string,
  draft?: PolicyDraft,
): string {
  const cards = buildPolicyCards(state, draft);
  const feedback = [
    savedAppId ? `<div class="feedback success" role="status">Policy saved for ${escapeHtml(savedAppId)}</div>` : "",
    formError ? `<div class="feedback error" role="alert">${escapeHtml(formError)}</div>` : "",
  ]
    .filter(Boolean)
    .join("");

  return `
    <section class="hero">
      <div class="hero-top">
        <div>
          <p class="eyebrow">Operator Console</p>
          <h1>Admin controls</h1>
          <p class="subtitle">Manage allowed assets, per-request ceilings, daily caps, and cooldowns from one operator surface without dropping to a CLI.</p>
        </div>
        <div class="badge">Role: ${escapeHtml(state.role)}</div>
      </div>
      <div class="grid stats">
        ${state.statusSummaries
          .map(
            (summary) => `
              <div class="stat">
                <span class="stat-label">${escapeHtml(summary.state)}</span>
                <span class="stat-value">${summary.count}</span>
              </div>
            `,
          )
          .join("")}
      </div>
      <div class="badge">${escapeHtml(getScopeDescription(state.role))}</div>
    </section>

    <div class="section-header">
      <h2>Policy editor</h2>
      <p>${state.apps.length} apps in scope, ${state.policies.length} policies configured</p>
    </div>
    ${feedback}
    <section class="policy-grid" data-testid="policy-grid">
      ${cards.map((card) => renderPolicyCard(card, context)).join("")}
    </section>

    <div class="section-header">
      <h2>Recent withdrawals</h2>
      <p>Read-only operational snapshot for the same role scope.</p>
    </div>
    <section class="panel">
      ${
        state.withdrawals.length === 0
          ? `<p class="empty">No withdrawals found.</p>`
          : `
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>App ID</th>
                ${state.role === "SUPER_ADMIN" ? "<th>User ID</th>" : ""}
                <th>Asset</th>
                <th>Amount</th>
                <th>State</th>
                <th>Created At</th>
                <th>Tx Hash</th>
              </tr>
            </thead>
            <tbody>
              ${state.withdrawals
                .map(
                  (withdrawal) => `
                    <tr>
                      <td>${escapeHtml(withdrawal.id)}</td>
                      <td>${escapeHtml(withdrawal.appId)}</td>
                      ${state.role === "SUPER_ADMIN" ? `<td>${escapeHtml(withdrawal.userId)}</td>` : ""}
                      <td>${escapeHtml(withdrawal.asset)}</td>
                      <td>${escapeHtml(withdrawal.amount)}</td>
                      <td>${escapeHtml(withdrawal.state)}</td>
                      <td>${escapeHtml(withdrawal.createdAt)}</td>
                      <td>${escapeHtml(withdrawal.txHash ?? "N/A")}</td>
                    </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
        `
      }
    </section>
  `;
}

function buildPolicyCards(
  state: Extract<DashboardPageState, { status: "ready" }>,
  draft?: PolicyDraft,
): Array<{
  appId: string;
  updatedBy: string | null;
  updatedAt: string;
  values: PolicyDraft;
}> {
  const policyMap = new Map<string, DashboardWithdrawalPolicy>(state.policies.map((policy) => [policy.appId, policy]));
  const appIds = Array.from(new Set([...state.apps.map((app) => app.appId), ...state.policies.map((policy) => policy.appId)])).sort();

  return appIds.map((appId) => {
    const policy = policyMap.get(appId);
    const values =
      draft?.appId === appId
        ? draft
        : {
            appId,
            allowedAssets: policy?.allowedAssets ?? ["CKB", "USDI"],
            maxPerRequest: policy?.maxPerRequest ?? "",
            perUserDailyMax: policy?.perUserDailyMax ?? "",
            perAppDailyMax: policy?.perAppDailyMax ?? "",
            cooldownSeconds: String(policy?.cooldownSeconds ?? 0),
          };

    return {
      appId,
      updatedBy: policy?.updatedBy ?? null,
      updatedAt: policy?.updatedAt ?? "Not yet configured",
      values,
    };
  });
}

function renderPolicyCard(
  card: {
    appId: string;
    updatedBy: string | null;
    updatedAt: string;
    values: PolicyDraft;
  },
  context: DashboardRequestContext,
): string {
  const ckbChecked = card.values.allowedAssets.includes("CKB") ? "checked" : "";
  const usdiChecked = card.values.allowedAssets.includes("USDI") ? "checked" : "";

  return `
    <article class="policy-card" data-testid="policy-card-${escapeHtml(card.appId)}">
      <h3>${escapeHtml(card.appId)}</h3>
      <p>Configure supported assets, thresholds, and operator cooldowns for this app.</p>
      <div class="card-meta">
        <span class="chip">Updated by ${escapeHtml(card.updatedBy ?? "N/A")}</span>
        <span class="chip">${escapeHtml(card.updatedAt)}</span>
      </div>
      <form method="post" action="/policies" data-testid="policy-form-${escapeHtml(card.appId)}">
        <input type="hidden" name="role" value="${escapeHtml(context.role)}" />
        <input type="hidden" name="adminUserId" value="${escapeHtml(context.adminUserId ?? "")}" />
        <input type="hidden" name="appId" value="${escapeHtml(card.appId)}" />
        <div class="field full">
          <label>Supported assets</label>
          <div class="checkboxes">
            <label><input type="checkbox" name="allowedAssets" value="CKB" ${ckbChecked} /> CKB</label>
            <label><input type="checkbox" name="allowedAssets" value="USDI" ${usdiChecked} /> USDI</label>
          </div>
        </div>
        <div class="field-grid">
          <div class="field">
            <label for="max-per-request-${escapeHtml(card.appId)}">Per-request max</label>
            <input id="max-per-request-${escapeHtml(card.appId)}" type="text" name="maxPerRequest" value="${escapeHtml(card.values.maxPerRequest)}" />
          </div>
          <div class="field">
            <label for="per-user-daily-max-${escapeHtml(card.appId)}">Per-user daily max</label>
            <input id="per-user-daily-max-${escapeHtml(card.appId)}" type="text" name="perUserDailyMax" value="${escapeHtml(card.values.perUserDailyMax)}" />
          </div>
          <div class="field">
            <label for="per-app-daily-max-${escapeHtml(card.appId)}">Per-app daily max</label>
            <input id="per-app-daily-max-${escapeHtml(card.appId)}" type="text" name="perAppDailyMax" value="${escapeHtml(card.values.perAppDailyMax)}" />
          </div>
          <div class="field">
            <label for="cooldown-seconds-${escapeHtml(card.appId)}">Cooldown seconds</label>
            <input id="cooldown-seconds-${escapeHtml(card.appId)}" type="number" min="0" step="1" name="cooldownSeconds" value="${escapeHtml(card.values.cooldownSeconds)}" />
          </div>
        </div>
        <button type="submit">Save policy</button>
      </form>
    </article>
  `;
}

function getScopeDescription(role: UserRole): string {
  if (role === "SUPER_ADMIN") {
    return "Global visibility across all communities";
  }
  return "Scoped visibility for assigned communities";
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Unknown error";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
