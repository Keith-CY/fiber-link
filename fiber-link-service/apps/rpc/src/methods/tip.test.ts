import { describe, it, expect } from "vitest";
import { handleTipCreate } from "./tip";

it("creates a tip intent with invoice", async () => {
  const res = await handleTipCreate({
    appId: "app1",
    postId: "p1",
    fromUserId: "u1",
    toUserId: "u2",
    asset: "USDI",
    amount: "10",
  });

  expect(res.invoice).toContain("fiber");
});
