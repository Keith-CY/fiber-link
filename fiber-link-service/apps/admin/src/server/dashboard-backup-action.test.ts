import { describe, expect, it } from "vitest";
import {
  handleDashboardBackupCaptureAction,
  handleDashboardBackupRestorePlanAction,
} from "./dashboard-backup-action";

describe("dashboard backup actions", () => {
  it("captures backup for SUPER_ADMIN", async () => {
    const result = await handleDashboardBackupCaptureAction(
      {
        roleHeader: "SUPER_ADMIN",
      },
      {
        captureBackup: async () => ({
          backupId: "20260321T080000Z",
          backupDir: "/tmp/backups/20260321T080000Z",
          archiveFile: "/tmp/backups/20260321T080000Z.tar.gz",
        }),
      },
    );

    expect(result.statusCode).toBe(303);
    expect(result.location).toContain("backupCaptureStatus=success");
    expect(result.location).toContain("backupCaptureBackupId=20260321T080000Z");
  });

  it("builds restore plan for SUPER_ADMIN", async () => {
    const result = await handleDashboardBackupRestorePlanAction(
      {
        roleHeader: "SUPER_ADMIN",
        body: {
          backupId: "20260321T080000Z",
        },
      },
      {
        buildBackupRestorePlan: async () => ({
          backupId: "20260321T080000Z",
          command: 'scripts/restore-compose-backup.sh --backup "/tmp/backups/20260321T080000Z.tar.gz" --yes',
          warnings: ["Restore is destructive."],
        }),
      },
    );

    expect(result.statusCode).toBe(303);
    expect(result.location).toContain("restoreBackupId=20260321T080000Z");
    expect(result.location).toContain("restoreCommand=scripts%2Frestore-compose-backup.sh");
  });

  it("rejects env-backed SUPER_ADMIN defaults outside fixture mode", async () => {
    const result = await handleDashboardBackupCaptureAction(
      {},
      {
        env: {
          ADMIN_DASHBOARD_DEFAULT_ROLE: "SUPER_ADMIN",
        } as NodeJS.ProcessEnv,
        captureBackup: async () => {
          throw new Error("should not be called");
        },
      },
    );

    expect(result.statusCode).toBe(303);
    expect(result.location).toContain("backupCaptureStatus=error");
    expect(result.location).toContain("backupCaptureMessage=Only+SUPER_ADMIN+can+capture+backups");
  });

  it("allows fixture-mode defaults for backup actions", async () => {
    const result = await handleDashboardBackupRestorePlanAction(
      {
        body: {
          backupId: "20260321T080000Z",
        },
      },
      {
        allowDefaultIdentityFallback: true,
        env: {
          ADMIN_DASHBOARD_DEFAULT_ROLE: "SUPER_ADMIN",
        } as NodeJS.ProcessEnv,
        buildBackupRestorePlan: async () => ({
          backupId: "20260321T080000Z",
          command: 'scripts/restore-compose-backup.sh --backup "/tmp/backups/20260321T080000Z.tar.gz" --yes',
          warnings: ["Restore is destructive."],
        }),
      },
    );

    expect(result.statusCode).toBe(303);
    expect(result.location).toContain("restoreBackupId=20260321T080000Z");
  });
});
