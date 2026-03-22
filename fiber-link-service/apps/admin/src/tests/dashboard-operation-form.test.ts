import { describe, expect, it } from "vitest";
import { readDashboardOperationFlash } from "../dashboard/dashboard-operation-form";

describe("dashboard operation form helpers", () => {
  it("returns no flash payload when query params are empty", () => {
    expect(readDashboardOperationFlash(new URLSearchParams())).toBeUndefined();
  });
});
