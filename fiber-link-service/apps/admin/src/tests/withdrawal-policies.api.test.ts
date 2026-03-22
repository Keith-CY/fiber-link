import { beforeEach, describe, expect, it, vi } from "vitest";

const handleDashboardPolicyAction = vi.fn();
const getDashboardFixtureDependencies = vi.fn();
const createDbClient = vi.fn();

vi.mock("../server/dashboard-policy-action", () => ({
  handleDashboardPolicyAction,
}));

vi.mock("../server/dashboard-fixture-store", () => ({
  getDashboardFixtureDependencies,
}));

vi.mock("@fiber-link/db", () => ({
  createDbClient,
}));

vi.mock("../server/api/routers/withdrawal-policy", () => ({
  withdrawalPolicyRouter: {
    createCaller: () => ({
      upsert: vi.fn(),
    }),
  },
}));

function createResponse() {
  return {
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    end: vi.fn(),
    writeHead: vi.fn(),
  };
}

describe("withdrawal policy api route", () => {
  beforeEach(() => {
    handleDashboardPolicyAction.mockReset();
    getDashboardFixtureDependencies.mockReset();
    createDbClient.mockReset();
    handleDashboardPolicyAction.mockResolvedValue({
      statusCode: 303,
      location: "/?savedAppId=app-beta",
    });
    getDashboardFixtureDependencies.mockReturnValue(undefined);
    createDbClient.mockReturnValue({ tag: "db-client" });
  });

  it("provides a real db factory outside fixture mode", async () => {
    const handler = (await import("../pages/api/withdrawal-policies")).default;
    const req = {
      method: "POST",
      headers: {},
      body: {
        appId: "app-beta",
      },
    };
    const res = createResponse();

    await handler(req as never, res as never);

    expect(handleDashboardPolicyAction).toHaveBeenCalledTimes(1);
    const deps = handleDashboardPolicyAction.mock.calls[0]?.[1];
    expect(deps).toEqual(
      expect.objectContaining({
        createDb: expect.any(Function),
        env: process.env,
        upsertPolicy: expect.any(Function),
      }),
    );
    expect(deps.createDb()).toEqual({ tag: "db-client" });
    expect(createDbClient).toHaveBeenCalledTimes(1);
    expect(res.writeHead).toHaveBeenCalledWith(303, { Location: "/?savedAppId=app-beta" });
  });
});
