import { describe, expect, it } from "vitest";
import {
  PROFILE_CATALOG,
  PROFILE_CONFIG_KEYS,
  applyConfigProfile,
  previewConfigProfileDiff,
  rollbackConfigProfile,
} from "./config-profiles";

describe("config profiles", () => {
  it("shows exact key/value diff preview before apply", () => {
    const current = {
      WORKER_MAX_RETRIES: "5",
      WORKER_RETRY_DELAY_MS: "120000",
    };

    const diff = previewConfigProfileDiff(current, PROFILE_CATALOG.standard);

    expect(diff).toContain("WORKER_MAX_RETRIES: 5 -> 3");
    expect(diff).toContain("WORKER_RETRY_DELAY_MS: 120000 -> 60000");
  });

  it("applies standard profile with provenance and changed keys", () => {
    const current = { WORKER_WITHDRAWAL_INTERVAL_MS: "30000" };
    const applied = applyConfigProfile(current, {
      profile: PROFILE_CATALOG.standard,
      appliedAtIso: "2026-02-23T00:00:00Z",
    });

    expect(applied.metadata.profileId).toBe("standard");
    expect(applied.metadata.previousProfileId).toBeUndefined();
    expect(applied.nextConfig.WORKER_WITHDRAWAL_INTERVAL_MS).toBe("30000");
    expect(applied.nextConfig.WORKER_SETTLEMENT_BATCH_SIZE).toBe("200");
    expect(applied.changedKeys.length).toBeGreaterThan(0);
  });

  it("does not silently overwrite custom tuning without explicit confirmation", () => {
    const current = {
      WORKER_MAX_RETRIES: "9", // custom value outside profile defaults
    };

    expect(() =>
      applyConfigProfile(current, {
        profile: PROFILE_CATALOG.standard,
      }),
    ).toThrow(/explicit confirmation required/);
  });

  it("allows managed profile-to-profile migration without force overwrite", () => {
    const current = {
      ...PROFILE_CATALOG.conservative.config,
      EXTRA_NON_PROFILE_KEY: "untouched",
    };

    const applied = applyConfigProfile(current, {
      profile: PROFILE_CATALOG.aggressive,
      previousProfileId: "conservative",
    });

    expect(applied.nextConfig.WORKER_SETTLEMENT_BATCH_SIZE).toBe(
      PROFILE_CATALOG.aggressive.config.WORKER_SETTLEMENT_BATCH_SIZE,
    );
    expect(applied.nextConfig.EXTRA_NON_PROFILE_KEY).toBe("untouched");
  });

  it("supports one-click rollback to exact previous values", () => {
    const previous = {
      WORKER_MAX_RETRIES: "5",
      WORKER_RETRY_DELAY_MS: "120000",
      CUSTOM_ONLY: "keep",
    };
    const applied = applyConfigProfile(previous, {
      profile: PROFILE_CATALOG.standard,
      appliedAtIso: "2026-02-23T00:00:00Z",
      allowOverwrite: true,
    });

    const rolledBack = rollbackConfigProfile(applied.nextConfig, applied.metadata.rollbackSnapshot);

    expect(rolledBack).toEqual(previous);
  });

  it("enforces schema completeness for every profile and key", () => {
    const expected = new Set(PROFILE_CONFIG_KEYS);

    for (const profile of Object.values(PROFILE_CATALOG)) {
      const actual = new Set(Object.keys(profile.config));
      expect(actual).toEqual(expected);
    }
  });
});
