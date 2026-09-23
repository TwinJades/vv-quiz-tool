export class ModelCallLimitError extends Error {
  constructor(readonly limit: number) {
    super(`Model call limit of ${limit} has been reached.`);
    this.name = "ModelCallLimitError";
  }
}

export class ModelCallBudget {
  readonly limit: number;
  #used = 0;

  constructor(limit = 300) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new RangeError("Model call limit must be a positive integer.");
    }
    this.limit = limit;
  }

  get used(): number {
    return this.#used;
  }

  get remaining(): number {
    return this.limit - this.#used;
  }

  consume(): number {
    if (this.#used >= this.limit) {
      throw new ModelCallLimitError(this.limit);
    }
    this.#used += 1;
    return this.#used;
  }
}

export interface RetryDecision {
  retry: boolean;
  next_attempt: number;
  delay_ms: number;
}

export function providerRetryDecision(attempt: number, maxAttempts = 3): RetryDecision {
  if (!Number.isInteger(attempt) || attempt < 1 || !Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("Retry attempts must be positive integers.");
  }
  return {
    retry: attempt < maxAttempts,
    next_attempt: attempt + 1,
    delay_ms: Math.min(500 * 2 ** (attempt - 1), 4_000),
  };
}

export function answerRetryAllowed(retriesAfterInitial: number, maxRetriesAfterInitial = 2): boolean {
  return retriesAfterInitial < maxRetriesAfterInitial;
}
