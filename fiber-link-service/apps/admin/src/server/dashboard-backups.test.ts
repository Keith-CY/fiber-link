import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildDashboardBackupRestorePlan,
  captureDashboardBackup,
  listDashboardBackupBundles,
} from "./dashboard-backups";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("dashboard backups", () => {
  it("lists backup bundles from manifest directories", () => {
    const root = mkdtempSync(join(tmpdir(), "fiber-link-backups-"));
    tempDirs.push(root);
    const bundleDir = join(root, "20260321T080000Z");
    mkdirSync(join(bundleDir, "metadata"), { recursive: true });
    writeFileSync(
      join(bundleDir, "metadata/manifest.json"),
      JSON.stringify({
        generatedAtUtc: "20260321T080000Z",
        retentionDays: 30,
        dryRun: false,
        overallStatus: "PASS",
      }),
    );
    writeFileSync(join(root, "20260321T080000Z.tar.gz"), "archive");

    expect(listDashboardBackupBundles({ backupRoot: root })).toEqual([
      {
        id: "20260321T080000Z",
        generatedAt: "20260321T080000Z",
        overallStatus: "PASS",
        retentionDays: 30,
        dryRun: false,
        backupDir: bundleDir,
        archiveFile: join(root, "20260321T080000Z.tar.gz"),
      },
    ]);
  });

  it("parses backup capture output from the runner", async () => {
    await expect(
      captureDashboardBackup({
        runner: async () => ({
          stdout:
            "RESULT=PASS CODE=0 BACKUP_DIR=/tmp/backups/20260321T080000Z BACKUP_ARCHIVE=/tmp/backups/20260321T080000Z.tar.gz",
          stderr: "",
        }),
      }),
    ).resolves.toEqual({
      backupId: "20260321T080000Z",
      backupDir: "/tmp/backups/20260321T080000Z",
      archiveFile: "/tmp/backups/20260321T080000Z.tar.gz",
    });
  });

  it("builds restore plan from the archive when available", () => {
    expect(
      buildDashboardBackupRestorePlan({
        id: "20260321T080000Z",
        generatedAt: "20260321T080000Z",
        overallStatus: "PASS",
        retentionDays: 30,
        dryRun: false,
        backupDir: "/tmp/backups/20260321T080000Z",
        archiveFile: "/tmp/backups/20260321T080000Z.tar.gz",
      }),
    ).toEqual({
      backupId: "20260321T080000Z",
      command: 'scripts/restore-compose-backup.sh --backup "/tmp/backups/20260321T080000Z.tar.gz" --yes',
      warnings: [
        "Restore is destructive and must be run with service downtime.",
        "Verify the selected backup bundle before executing the restore command.",
      ],
    });
  });
});
