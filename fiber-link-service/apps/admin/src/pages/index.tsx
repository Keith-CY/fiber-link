import type { ParsedUrlQuery } from "querystring";
import React from "react";
import {
  buildDashboardViewModel,
  type DashboardPageState,
  type DashboardWithdrawalPolicy,
} from "../dashboard/dashboard-page-model";
import {
  readDashboardPolicyFlash,
  type DashboardPolicyDraft,
  type DashboardPolicyFlash,
} from "../dashboard/dashboard-policy-form";

type HomePageProps = {
  initialState?: DashboardPageState;
  policyFlash?: DashboardPolicyFlash;
};

type HeaderValue = string | string[] | undefined;
type RequestHeaders = Record<string, HeaderValue>;

type PolicyCard = {
  appId: string;
  updatedBy: string | null;
  updatedAt: string;
  values: DashboardPolicyDraft;
};

export default function HomePage({ initialState = { status: "loading" }, policyFlash }: HomePageProps) {
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

  return (
    <main>
      <h1>{viewModel.title}</h1>
      <p>Role: {viewModel.role}</p>
      <p>{viewModel.roleVisibility.scopeDescription}</p>

      {policyFlash?.savedAppId ? <p role="status">Policy saved for {policyFlash.savedAppId}</p> : null}
      {policyFlash?.formError ? <p role="alert">{policyFlash.formError}</p> : null}

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

      <section>
        <h2>Withdrawal policies</h2>
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
                  <input type="checkbox" name="allowedAssets" value="CKB" defaultChecked={card.values.allowedAssets.includes("CKB")} />
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
    </main>
  );
}

export async function getServerSideProps(context: { req?: { headers?: RequestHeaders }; query?: ParsedUrlQuery }) {
  const { loadDashboardState } = await import("../server/dashboard-data");
  const headers = context.req?.headers ?? {};
  const initialState = await loadDashboardState({
    roleHeader: getHeader(headers, "x-admin-role"),
    adminUserIdHeader: getHeader(headers, "x-admin-user-id"),
  });

  return {
    props: {
      initialState,
      policyFlash: readDashboardPolicyFlash(toSearchParams(context.query ?? {})),
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
