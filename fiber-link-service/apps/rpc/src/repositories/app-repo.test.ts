import { describe, expect, it } from "vitest";
import { createInMemoryAppRepo } from "./app-repo";

describe("appRepo", () => {
  it("finds app by appId", async () => {
    const repo = createInMemoryAppRepo([{ appId: "app1", hmacSecret: "s1" }]);

    const found = await repo.findByAppId("app1");

    expect(found?.hmacSecret).toBe("s1");
  });

  it("upserts app secret", async () => {
    const repo = createInMemoryAppRepo([]);

    await repo.upsert({ appId: "app1", hmacSecret: "s1" });
    await repo.upsert({ appId: "app1", hmacSecret: "s2" });

    const found = await repo.findByAppId("app1");
    expect(found?.hmacSecret).toBe("s2");
  });
});
