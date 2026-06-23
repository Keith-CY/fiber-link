import type { AdminServices } from "./types";
import { createDbAdminServices } from "./db-services";
import { loadFixtureAdminServices } from "./fixture-services";

export * from "./types";
export { createDbAdminServices } from "./db-services";
export { createFixtureAdminServices, loadFixtureAdminServices, type DashboardFixture } from "./fixture-services";

let cachedDbServices: AdminServices | undefined;

/**
 * Pick the services implementation for a request. A configured
 * `ADMIN_DASHBOARD_FIXTURE_PATH` selects the in-memory fixture (tests +
 * acceptance harness); otherwise the real Postgres-backed services are used.
 *
 * The database-backed services are memoized so the tRPC handler reuses a single
 * connection pool across requests instead of opening one per XHR.
 */
export function createAdminServices(env: NodeJS.ProcessEnv = process.env): AdminServices {
  const fixture = loadFixtureAdminServices(env);
  if (fixture) {
    return fixture;
  }
  if (!cachedDbServices) {
    cachedDbServices = createDbAdminServices();
  }
  return cachedDbServices;
}
