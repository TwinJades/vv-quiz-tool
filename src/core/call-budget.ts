export class ModelCallLimitError extends Error {
  constructor(readonly limit: number) {
    super(`Model call limit of ${limit} has been reached.`);
    this.name = "ModelCallLimitError";
  }
}

export class ModelCallBudget {
  readonly limit: number;
  #used = 0;
  #reserved = 0;
  #persistence:((charged:number)=>Promise<void>)|null=null;
  #write:Promise<void>=Promise.resolve();
  get reserved():number{return this.#reserved;}
  setPersistence(persist:(charged:number)=>Promise<void>):void {this.#persistence=persist;}
  async flush():Promise<void>{await this.#write;}
  private changed():void {const persist=this.#persistence,charged=this.#used+this.#reserved;if(persist)this.#write=this.#write.then(()=>persist(charged));}

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
    return this.limit - this.#used - this.#reserved;
  }

  consume(): number {
    if (this.remaining <= 0) {
      throw new ModelCallLimitError(this.limit);
    }
    this.#used += 1;
    this.changed();
    return this.#used;
  }

  reserve(amount: number): { settle: (actual: number) => void } {
    if (!Number.isInteger(amount) || amount <= 0) throw new RangeError("Reservation must be a positive integer.");
    if (amount > this.remaining) throw new ModelCallLimitError(this.limit);
    this.#reserved += amount;
    this.changed();
    let settled = false;
    return { settle: actual => {
      if (settled || !Number.isInteger(actual) || actual < 0 || actual > amount) throw new RangeError("Invalid call reservation settlement.");
      settled = true;
      this.#reserved -= amount;
      this.#used += actual;
      this.changed();
    } };
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
