/** Format an ISO timestamp for dense operator tables; falls back to raw text. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
}

/** Truncate long identifiers / hashes for table cells while keeping a title. */
export function shorten(value: string | null | undefined, head = 8, tail = 6): string {
  if (!value) {
    return "—";
  }
  if (value.length <= head + tail + 1) {
    return value;
  }
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
