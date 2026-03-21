import { beforeEach, describe, expect, it, vi } from "vitest";

const loadDashboardState = vi.fn();

vi.mock("../server/dashboard-data", () => ({
  loadDashboardState,
}));

describe("dashboard page getServerSideProps", () => {
  beforeEach(() => {
    loadDashboardState.mockReset();
    loadDashboardState.mockResolvedValue({
      status: "ready",
      role: "SUPER_ADMIN",
      apps: [],
      withdrawals: [],
      statusSummaries: [],
      policies: [],
    });
  });

  it("omits empty flash props so Next can serialize the page", async () => {
    const { getServerSideProps } = await import("../pages/index");

    const result = await getServerSideProps({
      req: { headers: {} },
      query: {},
    });

    expect(result).toEqual({
      props: {
        initialState: {
          status: "ready",
          role: "SUPER_ADMIN",
          apps: [],
          withdrawals: [],
          statusSummaries: [],
          policies: [],
        },
      },
    });
  });
});
