import type { TrpcContext } from "../server/api/trpc";
import { getInitialDashboardState, loadDashboardState, type DashboardState } from "./dashboard-model";
import { buildDashboardRenderModel } from "./dashboard-view";

export type HomePageProps = {
  state: DashboardState;
};

export async function loadHomePageProps(ctx: TrpcContext): Promise<HomePageProps> {
  return { state: await loadDashboardState(ctx) };
}

export default function HomePage({ state = getInitialDashboardState() }: Partial<HomePageProps>) {
  const view = buildDashboardRenderModel(state);

  if (view.kind === "loading") {
    return (
      <main>
        <h1>{view.title}</h1>
        <p>{view.message}</p>
      </main>
    );
  }

  if (view.kind === "error") {
    return (
      <main>
        <h1>{view.title}</h1>
        <p role="alert">{view.message}</p>
      </main>
    );
  }

  return (
    <main>
      <h1>{view.title}</h1>
      <p>{view.scopeLabel}</p>

      <section>
        <h2>Status Summary</h2>
        <p>Total withdrawals: {view.totalWithdrawals}</p>
        <ul>
          {view.summaryRows.map((row) => (
            <li key={row.state}>
              {row.state}: {row.count}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Apps</h2>
        {view.appRows.length === 0 ? (
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
              {view.appRows.map((row) => (
                <tr key={row.appId}>
                  <td>{row.appId}</td>
                  <td>{row.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Withdrawals</h2>
        {view.withdrawalRows.length === 0 ? (
          <p>No withdrawals found.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>App ID</th>
                {view.showUserColumn ? <th>User ID</th> : null}
                <th>Asset</th>
                <th>Amount</th>
                <th>State</th>
                <th>Retry Count</th>
                <th>Last Error</th>
                <th>Created At</th>
                <th>Completed At</th>
              </tr>
            </thead>
            <tbody>
              {view.withdrawalRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>{row.appId}</td>
                  {view.showUserColumn ? <td>{row.userId}</td> : null}
                  <td>{row.asset}</td>
                  <td>{row.amount}</td>
                  <td>{row.state}</td>
                  <td>{row.retryCount}</td>
                  <td>{row.lastError}</td>
                  <td>{row.createdAt}</td>
                  <td>{row.completedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
