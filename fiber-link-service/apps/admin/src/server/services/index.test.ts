import { afterEach, describe, expect, it } from "vitest";
import { createAdminServices } from "./index";

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("createAdminServices", () => {
  it("returns the fixture implementation when a fixture path is configured", async () => {
    const services = createAdminServices({ ADMIN_DASHBOARD_FIXTURE_PATH: "fixtures/dashboard-proof.json" } as NodeJS.ProcessEnv);
    const apps = await services.listApps({ role: "SUPER_ADMIN" });
    expect(apps.length).toBeGreaterThan(0);
  });

  it("returns the database-backed implementation when no fixture path is set", () => {
    // A dummy URL lets the pg pool be constructed without connecting; the db
    // client reads process.env.DATABASE_URL directly.
    process.env.DATABASE_URL = "postgres://u:p@localhost:5432/db";
    delete process.env.ADMIN_DASHBOARD_FIXTURE_PATH;
    const services = createAdminServices();
    expect(typeof services.listApps).toBe("function");
    expect(typeof services.upsertPolicy).toBe("function");
  });
});
