import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DashboardRateLimitConfig } from "../dashboard/dashboard-page-model";

export type DashboardRateLimitDraft = {
  enabled: boolean;
  windowMs: string;
  maxRequests: string;
};

export type DashboardRateLimitChangeSet = {
  changedKeys: string[];
  envSnippet: string;
  rollbackSnippet: string;
};

type RateLimitKey = "RPC_RATE_LIMIT_ENABLED" | "RPC_RATE_LIMIT_WINDOW_MS" | "RPC_RATE_LIMIT_MAX_REQUESTS";

const RATE_LIMIT_KEYS: RateLimitKey[] = [
  "RPC_RATE_LIMIT_ENABLED",
  "RPC_RATE_LIMIT_WINDOW_MS",
  "RPC_RATE_LIMIT_MAX_REQUESTS",
];

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

function parsePositiveInteger(raw: string, key: string): string {
  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${key} must be a positive integer`);
  }

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return String(parsed);
}

function parseEnvFile(filePath: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^"(.*)"$/, "$1");
    parsed[key] = value;
  }
  return parsed;
}

function resolveRuntimeComposeEnvPath(env: NodeJS.ProcessEnv): string | undefined {
  const candidates = [env.COMPOSE_ENV_FILE, env.ENV_FILE];
  for (const candidate of candidates) {
    const normalized = candidate?.trim();
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

export function resolveAdminRepoRoot(cwd: string = process.cwd()): string {
  return resolve(cwd, "../../..");
}

export function resolveComposeEnvPath(repoRoot: string = resolveAdminRepoRoot(), env: NodeJS.ProcessEnv = process.env): string {
  const runtimeEnvPath = resolveRuntimeComposeEnvPath(env);
  if (runtimeEnvPath) {
    return runtimeEnvPath;
  }
  return resolve(repoRoot, "deploy/compose/.env");
}

export function loadDashboardRateLimitConfig(input: {
  env?: NodeJS.ProcessEnv;
  envFilePath?: string;
} = {}): DashboardRateLimitConfig {
  const env = input.env ?? process.env;
  const envFilePath = input.envFilePath ?? resolveComposeEnvPath(resolveAdminRepoRoot(), env);
  const envFileValues = existsSync(envFilePath) ? parseEnvFile(envFilePath) : undefined;

  const enabled = parseBoolean(envFileValues?.RPC_RATE_LIMIT_ENABLED ?? env.RPC_RATE_LIMIT_ENABLED, true);
  const windowMs = String(envFileValues?.RPC_RATE_LIMIT_WINDOW_MS ?? env.RPC_RATE_LIMIT_WINDOW_MS ?? "60000");
  const maxRequests = String(envFileValues?.RPC_RATE_LIMIT_MAX_REQUESTS ?? env.RPC_RATE_LIMIT_MAX_REQUESTS ?? "300");
  const redisUrl = envFileValues?.FIBER_LINK_RATE_LIMIT_REDIS_URL ?? env.FIBER_LINK_RATE_LIMIT_REDIS_URL ?? "redis://redis:6379/1";

  return {
    enabled,
    windowMs,
    maxRequests,
    redisUrl,
    sourceLabel: existsSync(envFilePath) ? "deploy/compose/.env" : "process.env defaults",
  };
}

export function parseDashboardRateLimitInput(raw: DashboardRateLimitDraft): DashboardRateLimitDraft {
  return {
    enabled: Boolean(raw.enabled),
    windowMs: parsePositiveInteger(raw.windowMs, "RPC_RATE_LIMIT_WINDOW_MS"),
    maxRequests: parsePositiveInteger(raw.maxRequests, "RPC_RATE_LIMIT_MAX_REQUESTS"),
  };
}

export function buildDashboardRateLimitChangeSet(
  current: DashboardRateLimitConfig,
  draft: DashboardRateLimitDraft,
): DashboardRateLimitChangeSet {
  const nextByKey: Record<RateLimitKey, string> = {
    RPC_RATE_LIMIT_ENABLED: draft.enabled ? "true" : "false",
    RPC_RATE_LIMIT_WINDOW_MS: draft.windowMs,
    RPC_RATE_LIMIT_MAX_REQUESTS: draft.maxRequests,
  };

  const currentByKey: Record<RateLimitKey, string> = {
    RPC_RATE_LIMIT_ENABLED: current.enabled ? "true" : "false",
    RPC_RATE_LIMIT_WINDOW_MS: current.windowMs,
    RPC_RATE_LIMIT_MAX_REQUESTS: current.maxRequests,
  };

  const changedKeys = RATE_LIMIT_KEYS.filter((key) => currentByKey[key] !== nextByKey[key]);
  const snippetKeys = changedKeys.length > 0 ? changedKeys : RATE_LIMIT_KEYS;

  return {
    changedKeys,
    envSnippet: snippetKeys.map((key) => `${key}=${nextByKey[key]}`).join("\n"),
    rollbackSnippet: snippetKeys.map((key) => `${key}=${currentByKey[key]}`).join("\n"),
  };
}
