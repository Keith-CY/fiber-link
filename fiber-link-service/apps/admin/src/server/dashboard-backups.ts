import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { DashboardBackupBundle } from "../dashboard/dashboard-page-model";
import { resolveAdminRepoRoot } from "./dashboard-rate-limit";

const execFileAsync = promisify(execFile);

export type BackupCommandRunner = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

export type DashboardBackupCaptureResult = {
  backupId: string;
  backupDir: string;
  archiveFile: string | null;
};

export type DashboardBackupRestorePlan = {
  backupId: string;
  command: string;
  warnings: string[];
};

function defaultRunner(file: string, args: string[]) {
  return execFileAsync(file, args);
}

export function resolveBackupRoot(repoRoot: string = resolveAdminRepoRoot()): string {
  return resolve(repoRoot, "deploy/compose/backups");
}

function parseManifestBundle(backupRoot: string, id: string): DashboardBackupBundle | null {
  const backupDir = resolve(backupRoot, id);
  const manifestPath = resolve(backupDir, "metadata/manifest.json");
  if (!existsSync(manifestPath)) {
    return null;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    generatedAtUtc?: string;
    retentionDays?: number;
    dryRun?: boolean;
    overallStatus?: string;
  };
  const archivePath = `${backupDir}.tar.gz`;

  return {
    id,
    generatedAt: manifest.generatedAtUtc ?? id,
    overallStatus: manifest.overallStatus ?? "UNKNOWN",
    retentionDays: Number(manifest.retentionDays ?? 0),
    dryRun: Boolean(manifest.dryRun),
    backupDir,
    archiveFile: existsSync(archivePath) ? archivePath : null,
  };
}

export function listDashboardBackupBundles(input: {
  backupRoot?: string;
} = {}): DashboardBackupBundle[] {
  const backupRoot = input.backupRoot ?? resolveBackupRoot();
  if (!existsSync(backupRoot)) {
    return [];
  }

  return readdirSync(backupRoot)
    .filter((entry) => statSync(resolve(backupRoot, entry)).isDirectory())
    .map((entry) => parseManifestBundle(backupRoot, entry))
    .filter((bundle): bundle is DashboardBackupBundle => bundle !== null)
    .sort((left, right) => right.id.localeCompare(left.id));
}

function parseCaptureResult(stdout: string): DashboardBackupCaptureResult {
  const matchBackupDir = stdout.match(/BACKUP_DIR=([^\s]+)/);
  if (!matchBackupDir) {
    throw new Error("capture-compose-backup.sh did not report BACKUP_DIR");
  }

  const backupDir = matchBackupDir[1];
  const matchArchive = stdout.match(/BACKUP_ARCHIVE=([^\s]+)/);
  return {
    backupId: backupDir.split("/").pop() ?? backupDir,
    backupDir,
    archiveFile: matchArchive ? matchArchive[1] : null,
  };
}

export async function captureDashboardBackup(input: {
  runner?: BackupCommandRunner;
  repoRoot?: string;
} = {}): Promise<DashboardBackupCaptureResult> {
  const repoRoot = input.repoRoot ?? resolveAdminRepoRoot();
  const runner = input.runner ?? defaultRunner;
  const scriptPath = resolve(repoRoot, "scripts/capture-compose-backup.sh");
  const { stdout } = await runner(scriptPath, []);
  return parseCaptureResult(stdout);
}

export function buildDashboardBackupRestorePlan(bundle: DashboardBackupBundle): DashboardBackupRestorePlan {
  const backupSource = bundle.archiveFile ?? bundle.backupDir;
  return {
    backupId: bundle.id,
    command: `scripts/restore-compose-backup.sh --backup "${backupSource}" --yes`,
    warnings: [
      "Restore is destructive and must be run with service downtime.",
      "Verify the selected backup bundle before executing the restore command.",
    ],
  };
}
