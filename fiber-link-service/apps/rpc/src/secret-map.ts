export type SecretMap = Record<string, string>;
import type { AppRepo } from "./repositories/app-repo";

export type SecretSource = "db" | "env_map" | "env_fallback" | "missing";

export function loadSecretMap() {
  const mapRaw = process.env.FIBER_LINK_HMAC_SECRET_MAP;
  if (!mapRaw) return null;
  try {
    return JSON.parse(mapRaw) as SecretMap;
  } catch (error) {
    console.error("FATAL: Invalid FIBER_LINK_HMAC_SECRET_MAP. Must be valid JSON.", error);
    throw new Error("Invalid FIBER_LINK_HMAC_SECRET_MAP");
  }
}

type ResolveSecretOptions = {
  appRepo: AppRepo;
  envSecretMap?: SecretMap | null;
  envFallbackSecret?: string;
  onResolve?: (meta: { appId: string; source: SecretSource }) => void;
};

export async function resolveSecretForApp(appId: string, options: ResolveSecretOptions): Promise<string> {
  const dbRecord = await options.appRepo.findByAppId(appId);
  if (dbRecord?.hmacSecret) {
    options.onResolve?.({ appId, source: "db" });
    return dbRecord.hmacSecret;
  }

  const fromMap = options.envSecretMap?.[appId];
  if (fromMap) {
    options.onResolve?.({ appId, source: "env_map" });
    return fromMap;
  }

  if (options.envFallbackSecret) {
    options.onResolve?.({ appId, source: "env_fallback" });
    return options.envFallbackSecret;
  }

  options.onResolve?.({ appId, source: "missing" });
  return "";
}
