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
      <main className="dashboard-shell">
        <div className="dashboard-page">
          <section className="section-card">
            <div className="section-header">
              <h1 className="section-title">{viewModel.title}</h1>
              <p className="section-caption">Loading dashboard data...</p>
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (viewModel.status === "error") {
    return (
      <main className="dashboard-shell">
        <div className="dashboard-page">
          <section className="section-card">
            <div className="section-header">
              <h1 className="section-title">{viewModel.title}</h1>
              <p className="notice notice--error" role="alert">
                Failed to load dashboard data: {viewModel.message}
              </p>
            </div>
          </section>
        </div>
      </main>
    );
  }

  const rateLimitFormValues = buildRateLimitFormValues(viewModel.operations?.rateLimit, operationFlash);
  const backupBundles = viewModel.operations?.backups.status === "ready" ? viewModel.operations.backups.bundles : [];

  return (
    <main className="dashboard-shell">
      <div className="dashboard-page">
        <section className="hero-panel">
          <p className="hero-kicker">Fiber Link service operation admin</p>
          <h1 className="hero-title">{viewModel.title}</h1>
          <p className="hero-summary">{viewModel.roleVisibility.scopeDescription}</p>

          <div className="hero-meta-row">
            <div className="hero-pill">
              <p className="hero-pill-label">Role</p>
              <p className="hero-pill-value">{viewModel.role}</p>
            </div>
            <div className="hero-pill">
              <p className="hero-pill-label">Visible apps</p>
              <p className="hero-pill-value">{viewModel.apps.length}</p>
            </div>
            <div className="hero-pill">
              <p className="hero-pill-label">Policy surfaces</p>
              <p className="hero-pill-value">{viewModel.roleVisibility.showGlobalControls ? "Global + app-scoped" : "App-scoped only"}</p>
            </div>
          </div>

          {viewModel.roleVisibility.showGlobalControls ? (
            <div className="hero-stat-grid">
              <article className="metric-tile">
                <p className="metric-label">Monitoring</p>
                <p className="metric-value">{describeMonitoring(viewModel)}</p>
              </article>
              <article className="metric-tile">
                <p className="metric-label">Rate limiting</p>
                <p className="metric-value">{describeRateLimiting(viewModel)}</p>
              </article>
              <article className="metric-tile">
                <p className="metric-label">Backups</p>
                <p className="metric-value">{describeBackups(backupBundles)}</p>
              </article>
            </div>
          ) : null}
        </section>

        <div className="card-grid">
          {viewModel.roleVisibility.showGlobalControls ? (
            <section className="section-card">
              <div className="section-header">
                <h2 className="section-title">Operations overview</h2>
                <p className="section-caption">The standalone operation admin should surface monitoring, rate-limit posture, and backup readiness at a glance.</p>
              </div>
              <ul className="overview-list">
                <li className="overview-item">
                  <p className="overview-label">Monitoring</p>
                  <p className="overview-value">{describeMonitoring(viewModel)}</p>
                </li>
                <li className="overview-item">
                  <p className="overview-label">Rate limiting</p>
                  <p className="overview-value">{describeRateLimiting(viewModel)}</p>
                </li>
                <li className="overview-item">
                  <p className="overview-label">Backups</p>
                  <p className="overview-value">{describeBackups(backupBundles)}</p>
                </li>
              </ul>
            </section>
          ) : null}

          <section className="section-card">
            <div className="section-header">
              <h2 className="section-title">Status summaries</h2>
              <p className="section-caption">Current withdrawal pipeline counts for the apps visible to this operator.</p>
            </div>
            <ul className="summary-badges">
              {viewModel.statusSummaries.map((summary) => (
                <li className="summary-badge" key={summary.state}>
                  <p className="summary-badge-label">{summary.state}</p>
                  <p className="summary-badge-value">{summary.count}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="card-grid">
          <section className="section-card">
            <div className="section-header">
              <h2 className="section-title">App list</h2>
              <p className="section-caption">Apps in the current operation-admin scope.</p>
            </div>
            {viewModel.apps.length === 0 ? (
              <p className="empty-state">No apps found.</p>
            ) : (
              <div className="table-shell">
                <table className="data-table">
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
              </div>
            )}
          </section>

          <section className="section-card">
            <div className="section-header">
              <h2 className="section-title">Withdrawals</h2>
              <p className="section-caption">Recent payout requests and their current state.</p>
            </div>
            {viewModel.withdrawals.length === 0 ? (
              <p className="empty-state">No withdrawals found.</p>
            ) : (
              <div className="table-shell">
                <table className="data-table">
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
              </div>
            )}
          </section>
        </div>

        {viewModel.roleVisibility.showGlobalControls ? (
          <section className="section-card">
            <div className="section-header">
              <h2 className="section-title">Monitoring</h2>
              <p className="section-caption">Runtime health and ops-summary details for the Fiber Link deployment surface.</p>
            </div>
            {viewModel.operations?.monitoring.status === "ready" ? (
              <>
                <ul className="detail-list">
                  <li className="detail-item">
                    <p className="detail-label">Status</p>
                    <p className="detail-value">{viewModel.operations.monitoring.summary.status}</p>
                  </li>
                  <li className="detail-item">
                    <p className="detail-label">Generated at</p>
                    <p className="detail-value">{formatDate(viewModel.operations.monitoring.summary.generatedAt)}</p>
                  </li>
                  <li className="detail-item">
                    <p className="detail-label">Readiness</p>
                    <p className="detail-value">{viewModel.operations.monitoring.summary.readinessStatus}</p>
                  </li>
                  <li className="detail-item">
                    <p className="detail-label">Alerts</p>
                    <p className="detail-value">{viewModel.operations.monitoring.summary.alertCount}</p>
                  </li>
                  <li className="detail-item">
                    <p className="detail-label">Unpaid backlog</p>
                    <p className="detail-value">{viewModel.operations.monitoring.summary.unpaidBacklog}</p>
                  </li>
                  <li className="detail-item">
                    <p className="detail-label">Retry pending</p>
                    <p className="detail-value">{viewModel.operations.monitoring.summary.retryPendingCount}</p>
                  </li>
                  <li className="detail-item">
                    <p className="detail-label">Withdrawal parity issues</p>
                    <p className="detail-value">{viewModel.operations.monitoring.summary.withdrawalParityIssueCount}</p>
                  </li>
                </ul>
                {viewModel.operations.monitoring.summary.rawJson ? (
                  <details className="raw-json">
                    <summary>Raw ops summary JSON</summary>
                    <pre className="code-block">{viewModel.operations.monitoring.summary.rawJson}</pre>
                  </details>
                ) : null}
              </>
            ) : (
              <p className="notice notice--error" role="alert">
                Monitoring unavailable: {viewModel.operations?.monitoring.message ?? "unknown error"}
              </p>
            )}
          </section>
        ) : null}

        <section className="section-card">
          <div className="section-header">
            <h2 className="section-title">App policy controls</h2>
            <p className="section-caption">Direct DB-backed withdrawal policy editing inside the standalone operation admin.</p>
          </div>
          {policyFlash?.savedAppId ? (
            <p className="notice notice--status" role="status">
              Policy saved for {policyFlash.savedAppId}
            </p>
          ) : null}
          {policyFlash?.formError ? (
            <p className="notice notice--error" role="alert">
              {policyFlash.formError}
            </p>
          ) : null}
          <div className="policy-grid">
            {buildPolicyCards(viewModel.policies, viewModel.apps.map((app) => app.appId), policyFlash?.draft).map((card) => (
              <article className="policy-card" key={card.appId}>
                <div className="section-header">
                  <h3 className="card-title">{card.appId}</h3>
                  <p className="card-meta">
                    Updated by {card.updatedBy ?? "N/A"} at {formatDate(card.updatedAt)}
                  </p>
                </div>
                <form className="form-stack" method="post" action="/api/withdrawal-policies" data-testid={`policy-form-${card.appId}`}>
                  <input type="hidden" name="appId" value={card.appId} />
                  <fieldset className="checkbox-group">
                    <legend>Allowed assets</legend>
                    <div className="checkbox-row">
                      <label className="checkbox-option">
                        <input
                          type="checkbox"
                          name="allowedAssets"
                          value="CKB"
                          defaultChecked={card.values.allowedAssets.includes("CKB")}
                        />
                        CKB
                      </label>
                      <label className="checkbox-option">
                        <input
                          type="checkbox"
                          name="allowedAssets"
                          value="USDI"
                          defaultChecked={card.values.allowedAssets.includes("USDI")}
                        />
                        USDI
                      </label>
                    </div>
                  </fieldset>
                  <div className="field-grid">
                    <label className="field">
                      <span className="field-label">Max Per Request</span>
                      <input type="text" name="maxPerRequest" defaultValue={card.values.maxPerRequest} />
                    </label>
                    <label className="field">
                      <span className="field-label">Per-User Daily Max</span>
                      <input type="text" name="perUserDailyMax" defaultValue={card.values.perUserDailyMax} />
                    </label>
                    <label className="field">
                      <span className="field-label">Per-App Daily Max</span>
                      <input type="text" name="perAppDailyMax" defaultValue={card.values.perAppDailyMax} />
                    </label>
                    <label className="field">
                      <span className="field-label">Cooldown Seconds</span>
                      <input type="number" name="cooldownSeconds" min={0} step={1} defaultValue={card.values.cooldownSeconds} />
                    </label>
                  </div>
                  <div className="button-row">
                    <button className="primary-button" type="submit">Save policy</button>
                  </div>
                </form>
              </article>
            ))}
          </div>
        </section>

        {viewModel.roleVisibility.showGlobalControls ? (
          <section className="section-card">
            <div className="section-header">
              <h2 className="section-title">Global rate limiting</h2>
              <p className="section-caption">Generate a change set for runtime rate-limit controls without hot-editing deployment env files.</p>
            </div>
            {viewModel.operations?.rateLimit.status === "ready" ? (
              <p className="card-meta">
                Current source: <span className="inline-source">{viewModel.operations.rateLimit.config.sourceLabel}</span> | Redis backend:{" "}
                {viewModel.operations.rateLimit.config.redisUrl ?? "unset"}
              </p>
            ) : (
              <p className="notice notice--error" role="alert">
                Rate limit configuration unavailable: {viewModel.operations?.rateLimit.message ?? "unknown error"}
              </p>
            )}
            {operationFlash?.rateLimitError ? (
              <p className="notice notice--error" role="alert">
                {operationFlash.rateLimitError}
              </p>
            ) : null}
            <form className="form-stack" method="post" action="/api/runtime-policies/rate-limit">
              <div className="toggle-row">
                <label className="toggle-option">
                  <input
                    type="checkbox"
                    name="enabled"
                    value="true"
                    defaultChecked={rateLimitFormValues.enabled}
                  />
                  Enable rate limiting
                </label>
              </div>
              <div className="field-grid">
                <label className="field">
                  <span className="field-label">Window (ms)</span>
                  <input type="text" name="windowMs" defaultValue={rateLimitFormValues.windowMs} />
                </label>
                <label className="field">
                  <span className="field-label">Max Requests</span>
                  <input type="text" name="maxRequests" defaultValue={rateLimitFormValues.maxRequests} />
                </label>
              </div>
              <div className="button-row">
                <button className="primary-button" type="submit">Generate rate-limit change set</button>
              </div>
            </form>

            {operationFlash?.rateLimitChangeSet ? (
              <article className="change-set-card">
                <h3 className="card-title">Generated change set</h3>
                <p className="card-meta">
                  Changed keys:{" "}
                  {operationFlash.rateLimitChangeSet.changedKeys.length > 0
                    ? operationFlash.rateLimitChangeSet.changedKeys.join(", ")
                    : "No effective changes"}
                </p>
                <pre className="code-block">{operationFlash.rateLimitChangeSet.envSnippet}</pre>
                <h3 className="card-title">Rollback snapshot</h3>
                <pre className="code-block">{operationFlash.rateLimitChangeSet.rollbackSnippet}</pre>
              </article>
            ) : null}
          </section>
        ) : null}

        {viewModel.roleVisibility.showGlobalControls ? (
          <section className="section-card">
            <div className="section-header">
              <h2 className="section-title">Backups</h2>
              <p className="section-caption">Capture backup bundles and generate restore plans without triggering destructive restore from the browser.</p>
            </div>
            {operationFlash?.backupCapture ? (
              <p
                className={`notice ${operationFlash.backupCapture.status === "error" ? "notice--error" : "notice--status"}`}
                role={operationFlash.backupCapture.status === "error" ? "alert" : "status"}
              >
                {operationFlash.backupCapture.message}
              </p>
            ) : null}
            <form className="form-stack" method="post" action="/api/backups/capture">
              <div className="button-row">
                <button className="primary-button" type="submit">Capture backup</button>
              </div>
            </form>

            {backupBundles.length === 0 ? (
              <p className="empty-state">No backup bundles found.</p>
            ) : (
              <div className="backup-grid">
                {backupBundles.map((bundle) => (
                  <article className="backup-card" key={bundle.id}>
                    <div className="section-header">
                      <h3 className="card-title">{bundle.id}</h3>
                      <p className="card-meta">
                        Generated at {bundle.generatedAt} | Status {bundle.overallStatus} | Retention {bundle.retentionDays} days
                      </p>
                    </div>
                    <p className="card-meta">Source: {bundle.archiveFile ?? bundle.backupDir}</p>
                    <form className="form-stack" method="post" action="/api/backups/restore-plan">
                      <input type="hidden" name="backupId" value={bundle.id} />
                      <div className="button-row">
                        <button className="primary-button" type="submit">Generate restore plan</button>
                      </div>
                    </form>
                  </article>
                ))}
              </div>
            )}

            {operationFlash?.backupRestorePlan ? (
              <article className="restore-plan-card">
                <h3 className="card-title">Restore plan</h3>
                <p className="card-meta">Selected backup: {operationFlash.backupRestorePlan.backupId}</p>
                <pre className="code-block">{operationFlash.backupRestorePlan.command}</pre>
                {(operationFlash.backupRestorePlan.warnings ?? []).length > 0 ? (
                  <ul className="restore-warnings">
                    {operationFlash.backupRestorePlan.warnings?.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}

export async function getServerSideProps(context: { req?: { headers?: RequestHeaders }; query?: ParsedUrlQuery }) {
  const { loadDashboardState } = await import("../server/dashboard-data");
  const headers = context.req?.headers ?? {};
  const searchParams = toSearchParams(context.query ?? {});
  const policyFlash = readDashboardPolicyFlash(searchParams);
  const operationFlash = readDashboardOperationFlash(searchParams);
  const initialState = await loadDashboardState({
    roleHeader: getHeader(headers, "x-admin-role"),
    adminUserIdHeader: getHeader(headers, "x-admin-user-id"),
  });

  return {
    props: {
      initialState,
      ...(policyFlash ? { policyFlash } : {}),
      ...(operationFlash ? { operationFlash } : {}),
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
