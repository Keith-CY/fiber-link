import { describe, expect, it } from "vitest";
import { TEMPLATE_CATALOG, applyTemplate, previewTemplateDiff, rollbackTemplate } from "./starter-templates";

describe("starter templates", () => {
  it("shows preview diff before apply", () => {
    const diff = previewTemplateDiff({ MODE: "single" }, TEMPLATE_CATALOG[1]!);
    expect(diff.join("\n")).toContain("MODE: single -> multi");
  });

  it("never silently overwrites custom config", () => {
    expect(() =>
      applyTemplate({ MODE: "custom" }, TEMPLATE_CATALOG[0]!, false),
    ).toThrow(/explicit confirmation required/);
  });

  it("supports deterministic apply and rollback", () => {
    const previous = { MODE: "single", RETRY_LIMIT: "2" };
    const applied = applyTemplate(previous, TEMPLATE_CATALOG[1]!, true);
    expect(applied.metadata.templateId).toBe("multi-community");
    expect(applied.nextConfig.RETRY_LIMIT).toBe("5");
    expect(rollbackTemplate(previous)).toEqual(previous);
  });
});
