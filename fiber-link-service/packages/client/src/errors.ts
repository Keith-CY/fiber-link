export class FiberLinkValidationError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "FiberLinkValidationError";
  }
}

export class FiberLinkResponseError extends Error {
  constructor(
    public readonly code: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = "FiberLinkResponseError";
  }
}

export class FiberLinkNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FiberLinkNetworkError";
  }
}
