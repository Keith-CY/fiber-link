export type ComputeRetryDelayOptions = {
  jitter?: boolean;
  maxDelayMs?: number;
};

export function computeRetryDelay(
  baseMs: number,
  retryCount: number,
  options: ComputeRetryDelayOptions = {},
): number {
  const { jitter = false, maxDelayMs } = options;
  const exponential = baseMs * 2 ** retryCount;
  let delay = maxDelayMs !== undefined ? Math.min(exponential, maxDelayMs) : exponential;
  if (jitter) {
    delay = Math.floor(delay * (0.5 + Math.random() * 0.5));
  }
  return delay;
}
