export type RpcEnvReport = {
  /** Fatal misconfigurations: the server refuses to boot. */
  errors: string[];
  /** Degraded-but-workable configurations: logged once at startup. */
  warnings: string[];
};

function isBlank(value: string | undefined): boolean {
  return !value || value.trim() === "";
}

/**
 * Validate the process environment before the server starts listening, so a
 * misconfigured deployment fails at boot with an actionable message instead of
 * surfacing as per-request errors minutes or hours later.
 *
 * Only called from the boot path (entry.ts); tests construct servers directly
 * and are unaffected.
 */
export function validateRpcEnv(env: NodeJS.ProcessEnv = process.env): RpcEnvReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (isBlank(env.DATABASE_URL)) {
    errors.push("DATABASE_URL is required (apps, tips, and withdrawals are stored in Postgres)");
  }

  const adapterMode = env.FIBER_ADAPTER_MODE?.trim().toLowerCase() || "rpc";
  if (adapterMode !== "simulation" && isBlank(env.FIBER_RPC_URL)) {
    errors.push("FIBER_RPC_URL is required unless FIBER_ADAPTER_MODE=simulation");
  }

  if (isBlank(env.FIBER_LINK_HMAC_SECRET)) {
    warnings.push("FIBER_LINK_HMAC_SECRET is unset: only per-app secrets from the database can authenticate requests");
  }

  if (isBlank(env.FIBER_LINK_NONCE_REDIS_URL) && isBlank(env.REDIS_URL)) {
    warnings.push(
      "No Redis URL configured (FIBER_LINK_NONCE_REDIS_URL / REDIS_URL): nonce replay protection falls back to in-process memory and is not safe across multiple instances",
    );
  }

  return { errors, warnings };
}
