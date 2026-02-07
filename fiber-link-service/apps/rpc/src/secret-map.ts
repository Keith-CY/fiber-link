export type SecretMap = Record<string, string>;

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
