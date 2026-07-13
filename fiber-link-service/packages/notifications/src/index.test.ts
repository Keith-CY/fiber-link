import { describe, expect, it } from "vitest";
import * as notifications from "./index";

describe("package entry point", () => {
  it("re-exports the public notification surface", () => {
    expect(typeof notifications.createDbNotificationRepo).toBe("function");
    expect(typeof notifications.createInMemoryNotificationRepo).toBe("function");
    expect(typeof notifications.createNotificationDispatcher).toBe("function");
    expect(typeof notifications.createNoopNotificationDispatcher).toBe("function");
    expect(typeof notifications.createWebhookChannelHandler).toBe("function");
  });
});
