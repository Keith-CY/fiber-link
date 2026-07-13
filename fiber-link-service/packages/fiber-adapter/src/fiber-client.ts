export class FiberRpcError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "FiberRpcError";
  }
}

export class FiberRpcTimeoutError extends FiberRpcError {
  constructor(timeoutMs: number) {
    super(`Fiber RPC timed out after ${timeoutMs}ms`);
    this.name = "FiberRpcTimeoutError";
  }
}

export type FiberRpcCallOptions = {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  retryCount?: number;
  retryDelayMs?: number;
  signal?: AbortSignal;
  omitParams?: boolean;
};

export type FiberRpcEndpoint = string | ({ endpoint: string } & FiberRpcCallOptions);

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_COUNT = 1;
const DEFAULT_RETRY_DELAY_MS = 250;

function resolveEndpointOptions(endpoint: FiberRpcEndpoint, options: FiberRpcCallOptions = {}) {
  if (typeof endpoint === "string") {
    return { endpoint, options };
  }

  const { endpoint: resolvedEndpoint, ...endpointOptions } = endpoint;
  return { endpoint: resolvedEndpoint, options: { ...endpointOptions, ...options } };
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function isRetryableError(error: unknown) {
  if (error instanceof FiberRpcTimeoutError) {
    return true;
  }
  if (error instanceof FiberRpcError) {
    return typeof error.code === "number" && [502, 503, 504].includes(error.code);
  }
  return error instanceof TypeError || isAbortError(error);
}

function delay(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("Fiber RPC aborted", "AbortError"));
  }
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    // biome-ignore lint/style/useConst: assigned after onAbort, which closes over it, is defined.
    let timeout: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason ?? new DOMException("Fiber RPC aborted", "AbortError"));
    };
    timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchWithTimeout(
  endpoint: string,
  init: RequestInit,
  options: Required<Pick<FiberRpcCallOptions, "timeoutMs">> & Pick<FiberRpcCallOptions, "fetchFn" | "signal">,
) {
  const fetchFn = options.fetchFn ?? fetch;
  const controller = new AbortController();
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const abortFromCaller = () => {
    controller.abort(options.signal?.reason ?? new DOMException("Fiber RPC aborted", "AbortError"));
  };

  if (options.signal?.aborted) {
    abortFromCaller();
  } else {
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  if (options.timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort(new FiberRpcTimeoutError(options.timeoutMs));
    }, options.timeoutMs);
  }

  try {
    return await fetchFn(endpoint, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw new FiberRpcTimeoutError(options.timeoutMs);
    }
    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function rpcCall(
  endpoint: FiberRpcEndpoint,
  method: string,
  params: unknown,
  callOptions: FiberRpcCallOptions = {},
) {
  const { endpoint: resolvedEndpoint, options } = resolveEndpointOptions(endpoint, callOptions);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryCount = options.retryCount ?? DEFAULT_RETRY_COUNT;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const init = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      options.omitParams ? { jsonrpc: "2.0", id: 1, method } : { jsonrpc: "2.0", id: 1, method, params: [params] },
    ),
  } satisfies RequestInit;

  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetchWithTimeout(resolvedEndpoint, init, {
        fetchFn: options.fetchFn,
        signal: options.signal,
        timeoutMs,
      });

      if (!response.ok) {
        throw new FiberRpcError(`Fiber RPC HTTP ${response.status}`, response.status);
      }

      const payload = await response.json();
      if (payload?.error) {
        throw new FiberRpcError(payload.error.message ?? "Fiber RPC error", payload.error.code, payload.error.data);
      }

      return payload?.result;
    } catch (error) {
      if (options.signal?.aborted) {
        throw options.signal.reason ?? error;
      }
      if (attempt >= retryCount || !isRetryableError(error)) {
        throw error;
      }
      await delay(retryDelayMs, options.signal);
    }
  }
}
