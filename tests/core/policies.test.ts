import { describe, expect, it } from "vitest";

import {
  answerRetryAllowed,
  ModelCallBudget,
  ModelCallLimitError,
  providerRetryDecision,
  shouldEnterCloseOut,
  transitionSession,
} from "../../src/core";

describe("runtime policies", () => {
  it("enforces an independent model call limit", () => {
    const budget = new ModelCallBudget(2);
    expect(budget.consume()).toBe(1);
    expect(budget.consume()).toBe(2);
    expect(() => budget.consume()).toThrow(ModelCallLimitError);
  });

  it("limits provider calls to three attempts by default", () => {
    expect(providerRetryDecision(1)).toMatchObject({ retry: true, next_attempt: 2 });
    expect(providerRetryDecision(3)).toMatchObject({ retry: false, next_attempt: 4 });
  });

  it("allows two answer retries after the initial answer", () => {
    expect(answerRetryAllowed(0)).toBe(true);
    expect(answerRetryAllowed(1)).toBe(true);
    expect(answerRetryAllowed(2)).toBe(false);
  });

  it("enters close-out at sixty seconds", () => {
    expect(shouldEnterCloseOut(61)).toBe(false);
    expect(shouldEnterCloseOut(60)).toBe(true);
  });

  it("allows only explicit state-machine transitions", () => {
    expect(transitionSession("CREATED", "WAIT_READY")).toBe("WAIT_READY");
    expect(() => transitionSession("SOLVE", "COMPLETE")).toThrow("Invalid session transition");
  });
});
