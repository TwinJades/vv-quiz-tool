import { describe, expect, it } from "vitest";
import { ModelCallBudget } from "../../src/core";

describe("call reservations for provider-owned searches", () => {
  it('persists outstanding reservations and their settlement in order',async()=>{
    const budget=new ModelCallBudget(3),records:number[]=[];
    budget.setPersistence(async charged=>{records.push(charged);});
    const reservation=budget.reserve(3);await budget.flush();expect(records).toEqual([3]);
    reservation.settle(2);await budget.flush();expect(records).toEqual([3,2]);
    budget.consume();await budget.flush();expect(records).toEqual([3,2,3]);
  });
  it("holds room for search, releases unused slots and prevents double settlement", () => {
    const budget = new ModelCallBudget(2);
    const request = budget.reserve(2);
    expect(budget.remaining).toBe(0);
    expect(() => budget.consume()).toThrow("limit");
    expect(budget.used).toBe(0);
    request.settle(1);
    expect(budget.used).toBe(1);
    expect(budget.remaining).toBe(1);
    expect(() => request.settle(1)).toThrow();
    budget.consume();
    expect(budget.used).toBe(2);
  });
});
