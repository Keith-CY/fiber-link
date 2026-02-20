export type UpgradeChecks = {
  compatibilityOk: boolean;
  diskOk: boolean;
  servicesReady: boolean;
};

export type PostChecks = {
  runtimeHealthy: boolean;
  firstPathValidated: boolean;
};

export type UpgradeAuditRecord = {
  action: "upgrade" | "rollback";
  fromVersion: string;
  toVersion: string;
  success: boolean;
  message: string;
};

export function runPrechecks(checks: UpgradeChecks): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!checks.compatibilityOk) reasons.push("compatibility");
  if (!checks.diskOk) reasons.push("disk");
  if (!checks.servicesReady) reasons.push("services");
  return { ok: reasons.length === 0, reasons };
}

export function runUpgradeFlow(input: {
  fromVersion: string;
  toVersion: string;
  prechecks: UpgradeChecks;
  postchecks: PostChecks;
  autoRollback: boolean;
}): { records: UpgradeAuditRecord[]; finalVersion: string } {
  const records: UpgradeAuditRecord[] = [];
  const pre = runPrechecks(input.prechecks);
  if (!pre.ok) {
    records.push({
      action: "upgrade",
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      success: false,
      message: `blocked by prechecks: ${pre.reasons.join(",")}`,
    });
    return { records, finalVersion: input.fromVersion };
  }

  records.push({ action: "upgrade", fromVersion: input.fromVersion, toVersion: input.toVersion, success: true, message: "upgrade applied" });

  const postOk = input.postchecks.runtimeHealthy && input.postchecks.firstPathValidated;
  if (postOk) return { records, finalVersion: input.toVersion };

  if (input.autoRollback) {
    records.push({
      action: "rollback",
      fromVersion: input.toVersion,
      toVersion: input.fromVersion,
      success: true,
      message: "postcheck failure triggered rollback",
    });
    return { records, finalVersion: input.fromVersion };
  }

  return { records, finalVersion: input.toVersion };
}
