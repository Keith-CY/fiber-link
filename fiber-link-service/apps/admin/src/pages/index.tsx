import type { ParsedUrlQuery } from "querystring";
import React from "react";
import {
  buildDashboardViewModel,
  type DashboardBackupBundle,
  type DashboardPageState,
  type DashboardRateLimitConfig,
  type DashboardWithdrawalPolicy,
} from "../dashboard/dashboard-page-model";
import {
  readDashboardPolicyFlash,
  type DashboardPolicyDraft,
  type DashboardPolicyFlash,
} from "../dashboard/dashboard-policy-form";
import {
  readDashboardOperationFlash,
  type DashboardOperationFlash,
  type DashboardRateLimitDraft,
} from "../dashboard/dashboard-operation-form";

type HomePageProps = {
  initialState?: DashboardPageState;
  policyFlash?: DashboardPolicyFlash;
  operationFlash?: DashboardOperationFlash;
};

type HeaderValue = string | string[] | undefined;
type RequestHeaders = Record<string, HeaderValue>;

type PolicyCard = {
  appId: string;
  updatedBy: string | null;
  updatedAt: string;
  values: DashboardPolicyDraft;
};

export default function HomePage({
  initialState = { status: "loading" },
  policyFlash,
  operationFlash,
}: HomePageProps) {
  const viewModel = buildDashboardViewModel(initialState);

  if (viewModel.status === "loading") {
    return (
      <main>
        <h1>{viewModel.title}</h1>
        <p>Loading dashboard data...</p>
      </main>
    );
  }

  if (viewModel.status === "error") {
    return (
      <main>
        <h1>{viewModel.title}</h1>
        <p role="alert">Failed to load dashboard data: {viewModel.message}</p>
      </main>
    );
  }

  const rateLimitFormValues = buildRateLimitFormValues(viewModel.operations?.rateLimit, operationFlash);
  const backupBundles = viewModel.operations?.backups.status === "ready" ? viewModel.operations.backups.bundles : [];

  return (
    <main>
      <h1>{viewModel.title}</h1>
      <p>Role: {viewModel.role}</p>
      <p>{viewModel.roleVisibility.scopeDescription}</p>

      {viewModel.roleVisibility.showGlobalControls ? (
        <section>
          <h2>Operations overview</h2>
          <ul>
            <li>Monitoring: {describeMonitoring(viewModel)}</li>
            <li>Rate limiting: {describeRateLimiting(viewModel)}</li>
            <li>Backups: {describeBackups(backupBundles)}</li>
          </ul>
        </section>
      ) : null}

      <section>
        <h2>Status summaries</h2>
        <ul>
          {viewModel.statusSummaries.map((summary) => (
            <li key={summary.state}>
              {summary.state}: {summary.count}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>App list</h2>
        {viewModel.apps.length === 0 ? (
          <p>No apps found.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>App ID</th>
                <th>Created At</th>
              </tr>
            </thead>
            <tbody>
              {viewModel.apps.map((app) => (
                <tr key={app.appId}>
                  <td>{app.appId}</td>
                  <td>{formatDate(app.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Withdrawals</h2>
        {viewModel.withdrawals.length === 0 ? (
          <p>No withdrawals found.</p>
        ) : (
          <table>
            <thead>
              <tr>
                {viewModel.withdrawalColumns.map((column) => (
                  <th key={column}>{toColumnLabel(column)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {viewModel.withdrawals.map((withdrawal) => (
                <tr key={withdrawal.id}>
                  <td>{withdrawal.id}</td>
                  <td>{withdrawal.appId}</td>
                  {viewModel.roleVisibility.showUserId ? <td>{withdrawal.userId}</td> : null}
                  <td>{withdrawal.asset}</td>
                  <td>{withdrawal.amount}</td>
                  <td>{withdrawal.state}</td>
                  <td>{formatDate(withdrawal.createdAt)}</td>
                  <td>{withdrawal.txHash ?? "N/A"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {viewModel.roleVisibility.showGlobalControls ? (
        <section>
          <h2>Monitoring</h2>
          {viewModel.operations?.monitoring.status === "ready" ? (
            <>
              <p>
                Status: {viewModel.operations.monitoring.summary.status} | Generated at{" "}
                {formatDate(viewModel.operations.monitoring.summary.generatedAt)}
              </p>
              <ul>
                <li>Readiness: {viewModel.operations.monitoring.summary.readinessStatus}</li>
                <li>Unpaid backlog: {viewModel.operations.monitoring.summary.unpaidBacklog}</li>
                <li>Retry pending: {viewModel.operations.monitoring.summary.retryPendingCount}</li>
                <li>
                  Withdrawal parity issues: {viewModel.operations.monitoring.summary.withdrawalParityIssueCount}
                </li>
                <li>Alerts: {viewModel.operations.monitoring.summary.alertCount}</li>
              </ul>
              {viewModel.operations.monitoring.summary.rawJson ? (
                <details>
                  <summary>Raw ops summary JSON</summary>
                  <pre>{viewModel.operations.monitoring.summary.rawJson}</pre>
                </details>
              ) : null}
            </>
          ) : (
            <p role="alert">Monitoring unavailable: {viewModel.operations?.monitoring.message ?? "unknown error"}</p>
          )}
        </section>
      ) : null}

      <section>
        <h2>App policy controls</h2>
        {policyFlash?.savedAppId ? <p role="status">Policy saved for {policyFlash.savedAppId}</p> : null}
        {policyFlash?.formError ? <p role="alert">{policyFlash.formError}</p> : null}
        {buildPolicyCards(viewModel.policies, viewModel.apps.map((app) => app.appId), policyFlash?.draft).map((card) => (
          <article key={card.appId}>
            <h3>{card.appId}</h3>
            <p>
              Updated by {card.updatedBy ?? "N/A"} at {formatDate(card.updatedAt)}
            </p>
            <form method="post" action="/api/withdrawal-policies" data-testid={`policy-form-${card.appId}`}>
              <input type="hidden" name="appId" value={card.appId} />
              <fieldset>
                <legend>Allowed assets</legend>
                <label>
                  <input
                    type="checkbox"
                    name="allowedAssets"
                    value="CKB"
                    defaultChecked={card.values.allowedAssets.includes("CKB")}
                  />
                  CKB
                </label>
                <label>
                  <input
                    type="checkbox"
                    name="allowedAssets"
                    value="USDI"
                    defaultChecked={card.values.allowedAssets.includes("USDI")}
                  />
                  USDI
                </label>
              </fieldset>
              <label>
                Max Per Request
                <input type="text" name="maxPerRequest" defaultValue={card.values.maxPerRequest} />
              </label>
              <label>
                Per-User Daily Max
                <input type="text" name="perUserDailyMax" defaultValue={card.values.perUserDailyMax} />
              </label>
              <label>
                Per-App Daily Max
                <input type="text" name="perAppDailyMax" defaultValue={card.values.perAppDailyMax} />
              </label>
              <label>
                Cooldown Seconds
                <input type="number" name="cooldownSeconds" min={0} step={1} defaultValue={card.values.cooldownSeconds} />
              </label>
              <button type="submit">Save policy</button>
            </form>
          </article>
        ))}
      </section>

      {viewModel.roleVisibility.showGlobalControls ? (
        <section>
          <h2>Global rate limiting</h2>
          {viewModel.operations?.rateLimit.status === "ready" ? (
            <p>
              Current source: {viewModel.operations.rateLimit.config.sourceLabel} | Redis backend:{" "}
              {viewModel.operations.rateLimit.config.redisUrl ?? "unset"}
            </p>
          ) : (
            <p role="alert">Rate limit configuration unavailable: {viewModel.operations?.rateLimit.message ?? "unknown error"}</p>
          )}
          {operationFlash?.rateLimitError ? <p role="alert">{operationFlash.rateLimitError}</p> : null}
          <form method="post" action="/api/runtime-policies/rate-limit">
            <label>
              <input
                type="checkbox"
                name="enabled"
                value="true"
                defaultChecked={rateLimitFormValues.enabled}
              />
              Enable rate limiting
            </label>
            <label>
              Window (ms)
              <input type="text" name="windowMs" defaultValue={rateLimitFormValues.windowMs} />
            </label>
            <label>
              Max Requests
              <input type="text" name="maxRequests" defaultValue={rateLimitFormValues.maxRequests} />
            </label>
            <button type="submit">Generate rate-limit change set</button>
          </form>

          {operationFlash?.rateLimitChangeSet ? (
            <article>
              <h3>Generated change set</h3>
              <p>
                Changed keys:{" "}
                {operationFlash.rateLimitChangeSet.changedKeys.length > 0
                  ? operationFlash.rateLimitChangeSet.changedKeys.join(", ")
                  : "No effective changes"}
              </p>
              <pre>{operationFlash.rateLimitChangeSet.envSnippet}</pre>
              <h3>Rollback snapshot</h3>
              <pre>{operationFlash.rateLimitChangeSet.rollbackSnippet}</pre>
            </article>
          ) : null}
        </section>
      ) : null}

      {viewModel.roleVisibility.showGlobalControls ? (
        <section>
          <h2>Backups</h2>
          {operationFlash?.backupCapture ? (
            <p role={operationFlash.backupCapture.status === "error" ? "alert" : "status"}>
              {operationFlash.backupCapture.message}
            </p>
          ) : null}
          <form method="post" action="/api/backups/capture">
            <button type="submit">Capture backup</button>
          </form>

          {backupBundles.length === 0 ? (
            <p>No backup bundles found.</p>
          ) : (
            backupBundles.map((bundle) => (
              <article key={bundle.id}>
                <h3>{bundle.id}</h3>
                <p>
                  Generated at {bundle.generatedAt} | Status {bundle.overallStatus} | Retention {bundle.retentionDays} days
                </p>
                <p>Source: {bundle.archiveFile ?? bundle.backupDir}</p>
                <form method="post" action="/api/backups/restore-plan">
                  <input type="hidden" name="backupId" value={bundle.id} />
                  <button type="submit">Generate restore plan</button>
                </form>
              </article>
            ))
          )}

          {operationFlash?.backupRestorePlan ? (
            <article>
              <h3>Restore plan</h3>
              <p>Selected backup: {operationFlash.backupRestorePlan.backupId}</p>
              <pre>{operationFlash.backupRestorePlan.command}</pre>
              {(operationFlash.backupRestorePlan.warnings ?? []).length > 0 ? (
                <ul>
                  {operationFlash.backupRestorePlan.warnings?.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
            </article>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}

export async function getServerSideProps(context: { req?: { headers?: RequestHeaders }; query?: ParsedUrlQuery }) {
  const { loadDashboardState } = await import("../server/dashboard-data");
  const headers = context.req?.headers ?? {};
  const searchParams = toSearchParams(context.query ?? {});
  const initialState = await loadDashboardState({
    roleHeader: getHeader(headers, "x-admin-role"),
    adminUserIdHeader: getHeader(headers, "x-admin-user-id"),
  });

  return {
    props: {
      initialState,
      policyFlash: readDashboardPolicyFlash(searchParams),
      operationFlash: readDashboardOperationFlash(searchParams),
    },
  };
}

function getHeader(headers: RequestHeaders, key: string): string | undefined {
  const value = headers[key];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function formatDate(dateText: string): string {
  return dateText;
}

function toSearchParams(query: ParsedUrlQuery): URLSearchParams {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        searchParams.append(key, item);
      }
      continue;
    }

    if (typeof value === "string") {
      searchParams.set(key, value);
    }
  }
  return searchParams;
}

function buildPolicyCards(
  policies: DashboardWithdrawalPolicy[],
  appIds: string[],
  draft?: DashboardPolicyDraft,
): PolicyCard[] {
  const policyMap = new Map(policies.map((policy) => [policy.appId, policy]));
  const orderedAppIds = Array.from(new Set([...appIds, ...policies.map((policy) => policy.appId)])).sort();

  return orderedAppIds.map((appId) => {
    const policy = policyMap.get(appId);
    const values =
      draft?.appId === appId
        ? draft
        : {
            appId,
            allowedAssets: policy?.allowedAssets ?? [],
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

function buildRateLimitFormValues(
  rateLimitState: DashboardPageState extends any ? any : never,
  operationFlash?: DashboardOperationFlash,
): DashboardRateLimitDraft {
  if (operationFlash?.rateLimitDraft) {
    return operationFlash.rateLimitDraft;
  }

  if (rateLimitState?.status === "ready") {
    const config = rateLimitState.config as DashboardRateLimitConfig;
    return {
      enabled: config.enabled,
      windowMs: config.windowMs,
      maxRequests: config.maxRequests,
    };
  }

  return {
    enabled: true,
    windowMs: "60000",
    maxRequests: "300",
  };
}

function describeMonitoring(viewModel: ReturnType<typeof buildDashboardViewModel>): string {
  if (viewModel.status !== "ready" || !viewModel.operations) {
    return "Unavailable";
  }
  if (viewModel.operations.monitoring.status !== "ready") {
    return "Unavailable";
  }
  return `${viewModel.operations.monitoring.summary.status} (${viewModel.operations.monitoring.summary.alertCount} alerts)`;
}

function describeRateLimiting(viewModel: ReturnType<typeof buildDashboardViewModel>): string {
  if (viewModel.status !== "ready" || !viewModel.operations) {
    return "Unavailable";
  }
  if (viewModel.operations.rateLimit.status !== "ready") {
    return "Unavailable";
  }
  return viewModel.operations.rateLimit.config.enabled
    ? `${viewModel.operations.rateLimit.config.maxRequests} requests / ${viewModel.operations.rateLimit.config.windowMs}ms`
    : "Disabled";
}

function describeBackups(bundles: DashboardBackupBundle[]): string {
  if (bundles.length === 0) {
    return "No bundles";
  }
  return `${bundles.length} bundle(s), latest ${bundles[0].id}`;
}

function toColumnLabel(column: string): string {
  switch (column) {
    case "appId":
      return "App ID";
    case "userId":
      return "User ID";
    case "createdAt":
      return "Created At";
    case "txHash":
      return "Tx Hash";
    default:
      return column.toUpperCase();
  }
}
