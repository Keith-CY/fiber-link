import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const nextConfigPath = resolve(currentDir, "../../next.config.js");
const repoRoot = resolve(dirname(nextConfigPath), "../../../");
const require = createRequire(import.meta.url);
const nextConfig = require(nextConfigPath);

describe("admin next config", () => {
  it("traces runtime files from the repository root", () => {
    expect(nextConfig.outputFileTracingRoot).toBe(repoRoot);
  });

  it("includes repo-level runtime scripts for ops routes", () => {
    expect(nextConfig.outputFileTracingIncludes?.["/"]).toEqual(
      expect.arrayContaining([
        "../../../deploy/compose/**/*",
        "../../../scripts/**/*",
      ]),
    );
    expect(nextConfig.outputFileTracingIncludes?.["/api/backups/capture"]).toEqual(
      expect.arrayContaining([
        "../../../deploy/compose/**/*",
        "../../../scripts/**/*",
      ]),
    );
    expect(nextConfig.outputFileTracingIncludes?.["/api/runtime-policies/rate-limit"]).toEqual(
      expect.arrayContaining([
        "../../../deploy/compose/**/*",
        "../../../scripts/**/*",
      ]),
    );
  });
});
