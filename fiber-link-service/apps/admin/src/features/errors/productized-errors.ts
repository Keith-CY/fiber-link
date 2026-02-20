export type ProductError = {
  id: string;
  summary: string;
  technicalDetail: string;
  nextActions: string[];
};

const KNOWN_ERROR_MAP: Record<string, Omit<ProductError, "technicalDetail">> = {
  ERR_CONFIG_INVALID: {
    id: "ERR_CONFIG_INVALID",
    summary: "Configuration is invalid.",
    nextActions: ["Open diagnostics", "Review required fields", "Retry after fixing config"],
  },
  ERR_ENDPOINT_TIMEOUT: {
    id: "ERR_ENDPOINT_TIMEOUT",
    summary: "Unable to reach critical endpoint.",
    nextActions: ["Check endpoint URL", "Verify network connectivity", "Retry"],
  },
};

export function toProductError(code: string, technicalDetail: string): ProductError {
  const known = KNOWN_ERROR_MAP[code];
  if (known) {
    return { ...known, technicalDetail };
  }

  return {
    id: "ERR_UNKNOWN",
    summary: "An unexpected error occurred.",
    technicalDetail,
    nextActions: ["Retry", "Open diagnostics", "Contact support with the shown error ID"],
  };
}
