#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function usage() {
  console.error(
    "Usage: node scripts/render-visual-acceptance-comment.mjs --summary-file <path> --output-file <path> --repository <owner/repo> --run-id <id> --screenshots-base-url <url> [--screenshots-dir <path>]",
  );
  process.exit(2);
}

const args = process.argv.slice(2);
const options = {};
for (let index = 0; index < args.length; index += 2) {
  const key = args[index];
  const value = args[index + 1];
  if (!key?.startsWith("--") || value == null) {
    usage();
  }
  options[key.slice(2)] = value;
}

const required = ["summary-file", "output-file", "repository", "run-id", "screenshots-base-url"];
for (const key of required) {
  if (!options[key]) {
    usage();
  }
}

const summaryPath = path.resolve(options["summary-file"]);
const outputPath = path.resolve(options["output-file"]);
const screenshotsDir = options["screenshots-dir"] ? path.resolve(options["screenshots-dir"]) : null;
const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
const steps = summary?.visualAcceptance?.steps;

if (!steps || typeof steps !== "object") {
  throw new Error(`summary file is missing visualAcceptance.steps: ${summaryPath}`);
}

const orderedSteps = [
  ["forumEntryPoints", "Forum entry points"],
  ["topicThread", "Topic + reply"],
  ["tipFlow", "Tip modal flow"],
  ["tipperDashboard", "Tipper dashboard"],
  ["authorDashboard", "Author dashboard"],
  ["withdrawalCompletion", "Withdrawal completion"],
  ["adminMonitoring", "Operation admin monitoring"],
  ["adminRateLimiting", "Operation admin rate limiting"],
  ["adminBackups", "Operation admin backups"],
  ["adminPolicyControls", "Operation admin policy controls"],
];

const baseUrl = options["screenshots-base-url"].replace(/\/+$/, "");
const lines = [
  "<!-- fiber-link-visual-acceptance -->",
  "## Visual Acceptance",
  "",
  `Commit: \`${summary.gitSha ?? "unknown"}\` | [Download artifact](https://github.com/${options.repository}/actions/runs/${options["run-id"]})`,
  "",
];

for (const [key, fallbackTitle] of orderedSteps) {
  const step = steps[key];
  if (!step) {
    continue;
  }

  lines.push(`### ${step.label || fallbackTitle}`);
  lines.push(`Status: **${step.ok ? "PASS" : "FAIL"}**`);
  if (step.withdrawalId) {
    lines.push(`Withdrawal: \`${step.withdrawalId}\` (${step.withdrawalState ?? "unknown"})`);
  }
  if (step.withdrawalTxHash) {
    lines.push(`Tx: \`${step.withdrawalTxHash}\``);
  }
  if (step.explorerUrl) {
    lines.push(`[Explorer proof](${step.explorerUrl})`);
  }
  lines.push("");

  let explorerScreenshotSkipped = false;
  for (const screenshot of Array.isArray(step.screenshots) ? step.screenshots : []) {
    const label = path.basename(screenshot, path.extname(screenshot));
    if (step.explorerUrl && /explorer/i.test(label)) {
      explorerScreenshotSkipped = true;
      continue;
    }
    if (screenshotsDir) {
      const screenshotFile = path.join(screenshotsDir, screenshot.replace(/^screenshots\//, ""));
      if (!fs.existsSync(screenshotFile)) {
        throw new Error(`missing screenshot file referenced by summary: ${screenshotFile}`);
      }
    }
    lines.push(`![${label}](${baseUrl}/${screenshot})`);
    lines.push("");
  }

  if (explorerScreenshotSkipped) {
    lines.push("Explorer browser screenshot omitted; use the Explorer proof link above for manual verification.");
    lines.push("");
  }
}

fs.writeFileSync(outputPath, `${lines.join("\n").trim()}\n`);
