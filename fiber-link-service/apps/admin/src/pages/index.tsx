import { buildDashboardViewModel, loadDashboardState, type DashboardPageState } from "./dashboard-data";

type HomePageProps = {
  initialState?: DashboardPageState;
};

type HeaderValue = string | string[] | undefined;
type RequestHeaders = Record<string, HeaderValue>;

export default function HomePage({ initialState = { status: "loading" } }: HomePageProps) {
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
    </main>
  );
}

export async function getServerSideProps(context: { req?: { headers?: RequestHeaders } }) {
  const headers = context.req?.headers ?? {};
  const initialState = await loadDashboardState({
    roleHeader: getHeader(headers, "x-admin-role"),
    adminUserIdHeader: getHeader(headers, "x-admin-user-id"),
  });

  return {
    props: {
      initialState,
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
