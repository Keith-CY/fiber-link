import { readFileSync } from "node:fs";

/**
 * Resolve the raw hot-wallet withdrawal private key from the environment.
 *
 * `FIBER_WITHDRAWAL_CKB_PRIVATE_KEY` (inline value) takes precedence. When it
 * is unset, `FIBER_WITHDRAWAL_CKB_PRIVATE_KEY_FILE` may point to a file whose
 * trimmed contents are the key — this supports Docker/K8s secret mounts so the
 * key never appears in `docker inspect`, process listings, or crash dumps of
 * the environment table.
 *
 * Returns null when neither source yields a non-empty value. File read
 * failures throw, with the underlying reason but never the file contents.
 */
let cachedProcessEnvKey: string | null | undefined;

export function readWithdrawalPrivateKeyRaw(env: NodeJS.ProcessEnv = process.env): string | null {
  // Cache the process.env resolution: the file variant is a static secret
  // mount, and readFileSync on the request path would block the event loop.
  // Explicit env objects (tests) bypass the cache.
  if (env === process.env && cachedProcessEnvKey !== undefined) {
    return cachedProcessEnvKey;
  }

  const resolved = resolveWithdrawalPrivateKeyRaw(env);
  if (env === process.env) {
    cachedProcessEnvKey = resolved;
  }
  return resolved;
}

function resolveWithdrawalPrivateKeyRaw(env: NodeJS.ProcessEnv): string | null {
  const inline = env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY?.trim();
  if (inline) {
    return inline;
  }

  const filePath = env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY_FILE?.trim();
  if (!filePath) {
    return null;
  }

  let contents: string;
  try {
    contents = readFileSync(filePath, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to read FIBER_WITHDRAWAL_CKB_PRIVATE_KEY_FILE: ${reason}`);
  }
  return contents.trim() || null;
}

/** Presence probe used by capability checks; never throws. */
export function hasWithdrawalPrivateKey(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    return readWithdrawalPrivateKeyRaw(env) !== null;
  } catch {
    return false;
  }
}
