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
// Cache file reads by path: the file variant is a static secret mount, and
// readFileSync on the request path would block the event loop. Only the file
// read is cached — inline env lookups stay live so tests (and operators) can
// change FIBER_WITHDRAWAL_CKB_PRIVATE_KEY without stale results. Read
// failures are not cached.
const keyFileCache = new Map<string, string | null>();

function readKeyFile(filePath: string): string | null {
  const cached = keyFileCache.get(filePath);
  if (cached !== undefined) {
    return cached;
  }

  let contents: string;
  try {
    contents = readFileSync(filePath, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to read FIBER_WITHDRAWAL_CKB_PRIVATE_KEY_FILE: ${reason}`);
  }
  const trimmed = contents.trim() || null;
  keyFileCache.set(filePath, trimmed);
  return trimmed;
}

export function readWithdrawalPrivateKeyRaw(env: NodeJS.ProcessEnv = process.env): string | null {
  const inline = env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY?.trim();
  if (inline) {
    return inline;
  }

  const filePath = env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY_FILE?.trim();
  if (!filePath) {
    return null;
  }

  return readKeyFile(filePath);
}

/** Presence probe used by capability checks; never throws. */
export function hasWithdrawalPrivateKey(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    return readWithdrawalPrivateKeyRaw(env) !== null;
  } catch {
    return false;
  }
}
