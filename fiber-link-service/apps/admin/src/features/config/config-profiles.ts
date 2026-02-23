export const PROFILE_CONFIG_KEYS = [
  "WORKER_WITHDRAWAL_INTERVAL_MS",
  "WORKER_SETTLEMENT_INTERVAL_MS",
  "WORKER_SETTLEMENT_BATCH_SIZE",
  "WORKER_MAX_RETRIES",
  "WORKER_RETRY_DELAY_MS",
  "WORKER_SETTLEMENT_MAX_RETRIES",
  "WORKER_SETTLEMENT_RETRY_DELAY_MS",
  "WORKER_SETTLEMENT_PENDING_TIMEOUT_MS",
  "WORKER_SETTLEMENT_SUBSCRIPTION_CONCURRENCY",
] as const;

export type ProfileConfigKey = (typeof PROFILE_CONFIG_KEYS)[number];
export type ProfileId = "conservative" | "standard" | "aggressive";
export type ProfileConfig = Record<ProfileConfigKey, string>;

export type ConfigProfile = {
  id: ProfileId;
  version: string;
  description: string;
  tradeoffs: string[];
  config: ProfileConfig;
};

export type ProfileRollbackSnapshot = Record<ProfileConfigKey, string | null>;

export type ProfileApplyMetadata = {
  profileId: ProfileId;
  version: string;
  appliedAt: string;
  previousProfileId?: ProfileId;
  rollbackSnapshot: ProfileRollbackSnapshot;
};

export type ProfileApplyResult = {
  nextConfig: Record<string, string>;
  changedKeys: ProfileConfigKey[];
  metadata: ProfileApplyMetadata;
};

export const PROFILE_CATALOG: Record<ProfileId, ConfigProfile> = {
  conservative: {
    id: "conservative",
    version: "1.0.0",
    description: "Lower throughput, slower retries, longer timeout windows.",
    tradeoffs: ["Lower load on worker and node", "Longer recovery windows for transient failures"],
    config: {
      WORKER_WITHDRAWAL_INTERVAL_MS: "45000",
      WORKER_SETTLEMENT_INTERVAL_MS: "45000",
      WORKER_SETTLEMENT_BATCH_SIZE: "100",
      WORKER_MAX_RETRIES: "5",
      WORKER_RETRY_DELAY_MS: "120000",
      WORKER_SETTLEMENT_MAX_RETRIES: "5",
      WORKER_SETTLEMENT_RETRY_DELAY_MS: "120000",
      WORKER_SETTLEMENT_PENDING_TIMEOUT_MS: "3600000",
      WORKER_SETTLEMENT_SUBSCRIPTION_CONCURRENCY: "1",
    },
  },
  standard: {
    id: "standard",
    version: "1.0.0",
    description: "Balanced defaults for stable day-to-day operations.",
    tradeoffs: ["Balanced throughput and recovery", "Moderate queue pressure"],
    config: {
      WORKER_WITHDRAWAL_INTERVAL_MS: "30000",
      WORKER_SETTLEMENT_INTERVAL_MS: "30000",
      WORKER_SETTLEMENT_BATCH_SIZE: "200",
      WORKER_MAX_RETRIES: "3",
      WORKER_RETRY_DELAY_MS: "60000",
      WORKER_SETTLEMENT_MAX_RETRIES: "3",
      WORKER_SETTLEMENT_RETRY_DELAY_MS: "60000",
      WORKER_SETTLEMENT_PENDING_TIMEOUT_MS: "1800000",
      WORKER_SETTLEMENT_SUBSCRIPTION_CONCURRENCY: "2",
    },
  },
  aggressive: {
    id: "aggressive",
    version: "1.0.0",
    description: "Higher throughput and tighter retry timings.",
    tradeoffs: ["Faster event processing", "Higher runtime pressure and tighter failure windows"],
    config: {
      WORKER_WITHDRAWAL_INTERVAL_MS: "15000",
      WORKER_SETTLEMENT_INTERVAL_MS: "15000",
      WORKER_SETTLEMENT_BATCH_SIZE: "400",
      WORKER_MAX_RETRIES: "2",
      WORKER_RETRY_DELAY_MS: "30000",
      WORKER_SETTLEMENT_MAX_RETRIES: "2",
      WORKER_SETTLEMENT_RETRY_DELAY_MS: "30000",
      WORKER_SETTLEMENT_PENDING_TIMEOUT_MS: "900000",
      WORKER_SETTLEMENT_SUBSCRIPTION_CONCURRENCY: "4",
    },
  },
};

const KEY_MINIMUMS: Record<ProfileConfigKey, number> = {
  WORKER_WITHDRAWAL_INTERVAL_MS: 1,
  WORKER_SETTLEMENT_INTERVAL_MS: 1,
  WORKER_SETTLEMENT_BATCH_SIZE: 1,
  WORKER_MAX_RETRIES: 0,
  WORKER_RETRY_DELAY_MS: 1,
  WORKER_SETTLEMENT_MAX_RETRIES: 0,
  WORKER_SETTLEMENT_RETRY_DELAY_MS: 1,
  WORKER_SETTLEMENT_PENDING_TIMEOUT_MS: 1,
  WORKER_SETTLEMENT_SUBSCRIPTION_CONCURRENCY: 1,
};

function validateProfileCatalog(catalog: Record<ProfileId, ConfigProfile>): void {
  for (const profile of Object.values(catalog)) {
    const profileKeys = Object.keys(profile.config).sort();
    const expectedKeys = [...PROFILE_CONFIG_KEYS].sort();
    if (profileKeys.length !== expectedKeys.length || !profileKeys.every((key, idx) => key === expectedKeys[idx])) {
      throw new Error(`Profile ${profile.id} has incomplete config schema`);
    }

    for (const key of PROFILE_CONFIG_KEYS) {
      const raw = profile.config[key];
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < KEY_MINIMUMS[key]) {
        throw new Error(`Profile ${profile.id} has invalid ${key}; expected integer >= ${KEY_MINIMUMS[key]}`);
      }
    }
  }
}

validateProfileCatalog(PROFILE_CATALOG);

function buildRollbackSnapshot(current: Record<string, string>): ProfileRollbackSnapshot {
  const snapshot = {} as ProfileRollbackSnapshot;
  for (const key of PROFILE_CONFIG_KEYS) {
    snapshot[key] = current[key] ?? null;
  }
  return snapshot;
}

function findConflictKeys(
  current: Record<string, string>,
  target: ConfigProfile,
  previousProfileId?: ProfileId,
): ProfileConfigKey[] {
  const previousProfile = previousProfileId ? PROFILE_CATALOG[previousProfileId] : undefined;
  const conflicts: ProfileConfigKey[] = [];

  for (const key of PROFILE_CONFIG_KEYS) {
    const currentValue = current[key];
    const nextValue = target.config[key];

    if (currentValue === undefined || currentValue === nextValue) {
      continue;
    }

    // Profile-to-profile migration is safe when current values still match the previous profile baseline.
    if (previousProfile && currentValue === previousProfile.config[key]) {
      continue;
    }

    conflicts.push(key);
  }

  return conflicts;
}

export function previewConfigProfileDiff(
  current: Record<string, string>,
  profile: ConfigProfile,
): string[] {
  return PROFILE_CONFIG_KEYS.map(
    (key) => `${key}: ${current[key] ?? "<unset>"} -> ${profile.config[key]}`,
  );
}

export function applyConfigProfile(
  current: Record<string, string>,
  input: {
    profile: ConfigProfile;
    previousProfileId?: ProfileId;
    allowOverwrite?: boolean;
    appliedAtIso?: string;
  },
): ProfileApplyResult {
  const conflicts = findConflictKeys(current, input.profile, input.previousProfileId);
  if (conflicts.length > 0 && !input.allowOverwrite) {
    throw new Error(
      `Conflict on ${conflicts.join(", ")}; explicit confirmation required`,
    );
  }

  const nextConfig = {
    ...current,
    ...input.profile.config,
  };

  const changedKeys = PROFILE_CONFIG_KEYS.filter((key) => current[key] !== nextConfig[key]);
  const metadata: ProfileApplyMetadata = {
    profileId: input.profile.id,
    version: input.profile.version,
    appliedAt: input.appliedAtIso ?? new Date().toISOString(),
    previousProfileId: input.previousProfileId,
    rollbackSnapshot: buildRollbackSnapshot(current),
  };

  return {
    nextConfig,
    changedKeys,
    metadata,
  };
}

export function rollbackConfigProfile(
  current: Record<string, string>,
  snapshot: ProfileRollbackSnapshot,
): Record<string, string> {
  const restored = { ...current };
  for (const key of PROFILE_CONFIG_KEYS) {
    const previous = snapshot[key];
    if (previous === null) {
      delete restored[key];
      continue;
    }
    restored[key] = previous;
  }
  return restored;
}
