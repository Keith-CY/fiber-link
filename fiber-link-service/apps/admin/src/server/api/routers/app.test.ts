import { describe, it, expect } from "vitest";
import { appRouter } from "./app";

describe("app router", () => {
  it("exports router", () => {
    expect(appRouter).toBeDefined();
  });
});
