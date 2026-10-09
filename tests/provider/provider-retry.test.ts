import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderProfile, QuestionBatch } from "../../src/core";
import { ModelCallBudget } from "../../src/core";
import { VercelAiSolverProvider } from "../../src/provider/solver-provider";
const mocks = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("ai", async importOriginal => ({ ...await importOriginal<typeof import("ai")>(), generateText: mocks.generate }));

const profile: ProviderProfile = { schema_version: "1.0", provider_profile_id: "p", display_name: "local test", provider_type: "openai_compatible", base_url: "https://example.test/v1", secret_ref: "test", model_catalog: { source: "manual", models: ["test"], refreshed_at: null }, capabilities: { image_input: false, structured_output: true, native_web_search: false }, image_upload_authorized: false };
const batch: QuestionBatch = { schema_version: "1.0", session_id: "s", batch_id: "b", question_ids: ["q"], questions: [{ schema_version: "1.0", session_id: "s", question_id: "q", observation_id: "o", type: "single_choice", stem: { text: "Choose A", format: "plain_text", media: [] }, options: [{ id: "a", text: "A", media: [] }], blanks: [], constraints: { min_selections: 1, max_selections: 1 }, provenance: { text_source: "dom", untrusted_content: true } }], capability_requirements: { image_input: false, native_web_search: false }, attempt: 1 };
afterEach(() => { vi.useRealTimers(); mocks.generate.mockReset(); });

describe("provider retry accounting", () => {
  it("pauses course solving on HTTP 429 without retrying or resetting its budget",async()=>{
    mocks.generate.mockRejectedValue(Object.assign(new Error('quota exhausted'),{statusCode:429}));
    const budget=new ModelCallBudget(10);
    const solver=new VercelAiSolverProvider(profile,'gemini-3.8-flash','unused',budget,undefined,120_000,true);
    await expect(solver.solve(batch,{strategy:'unattended',allow_images:false},[])).rejects.toThrow(/429/);
    expect(mocks.generate).toHaveBeenCalledTimes(1);expect(budget.used).toBe(1);
  });
  it("retries snapshot structure network failures three times against the same budget", async () => {
    vi.useFakeTimers();
    mocks.generate.mockRejectedValue(Object.assign(new Error("Network error"), { statusCode: 503 }));
    const controller = new AbortController();
    const budget = new ModelCallBudget(3);
    const solver = new VercelAiSolverProvider(profile, "test", "unused", budget);
    const outcome = solver.calibrateSeparation({ visible_text: "Question?", candidates: [] }, controller.signal).catch(error => error);
    await vi.runAllTimersAsync();
    expect(await outcome).toMatchObject({ code: "NETWORK" });
    expect(budget.used).toBe(3);
    expect(mocks.generate).toHaveBeenCalledTimes(3);
    expect(mocks.generate.mock.calls.every(([request]) => request.maxRetries === 0 && request.abortSignal === controller.signal)).toBe(true);
  });

  it("does not dispatch an already cancelled structure snapshot", async () => {
    const controller = new AbortController(); controller.abort();
    const budget = new ModelCallBudget();
    const solver = new VercelAiSolverProvider(profile, "test", "unused", budget);
    await expect(solver.calibrateSeparation({ visible_text: "Question?", candidates: [] }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(budget.used).toBe(0);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("cancels structure snapshot backoff without another charged request", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    mocks.generate.mockRejectedValue(Object.assign(new Error("Network error"), { statusCode: 503 }));
    const budget = new ModelCallBudget(3);
    const solver = new VercelAiSolverProvider(profile, "test", "unused", budget);
    const outcome = solver.calibrateSeparation({ visible_text: "Question?", candidates: [] }, controller.signal).catch(error => error);
    await vi.advanceTimersByTimeAsync(0); controller.abort();
    expect(await outcome).toMatchObject({ code: "ABORTED" });
    expect(budget.used).toBe(1);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("counts all three HTTP 503 attempts even without a numeric status in the message", async () => {
    vi.useFakeTimers();
    mocks.generate.mockRejectedValue(Object.assign(new Error("Service Temporarily Unavailable"), { statusCode: 503 }));
    const budget = new ModelCallBudget(10);
    const solver = new VercelAiSolverProvider(profile, "test", "unused", budget);
    const outcome = solver.solve(batch, { strategy: "unattended", allow_images: false }, []).catch(error => error);
    await vi.runAllTimersAsync();
    expect(await outcome).toMatchObject({ code: "NETWORK" });
    expect(budget.used).toBe(3);
    expect(mocks.generate).toHaveBeenCalledTimes(3);
    expect(mocks.generate.mock.calls.every(([request]) => request.maxRetries === 0)).toBe(true);
  });

  it("does not retry authentication failures or consume beyond the call limit", async () => {
    mocks.generate.mockRejectedValue(Object.assign(new Error("Rejected"), { statusCode: 401 }));
    const budget = new ModelCallBudget(1);
    const solver = new VercelAiSolverProvider(profile, "test", "unused", budget);
    await expect(solver.solve(batch, { strategy: "unattended", allow_images: false }, [])).rejects.toMatchObject({ code: "AUTHENTICATION" });
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    await expect(solver.solve(batch, { strategy: "unattended", allow_images: false }, [])).rejects.toThrow("limit");
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });

  it("does not charge or dispatch an already cancelled request", async () => {
    const controller = new AbortController(); controller.abort();
    const budget = new ModelCallBudget();
    const solver = new VercelAiSolverProvider(profile, "test", "unused", budget);
    await expect(solver.solve(batch, { strategy: "unattended", allow_images: false }, [], controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(budget.used).toBe(0);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("does not retry a failed in-flight request after cancellation", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    mocks.generate.mockImplementation(async () => { controller.abort(); throw Object.assign(new Error("Network error"), { statusCode: 503 }); });
    const budget = new ModelCallBudget(3);
    const solver = new VercelAiSolverProvider(profile, "test", "unused", budget);
    await expect(solver.solve(batch, { strategy: "unattended", allow_images: false }, [], controller.signal)).rejects.toMatchObject({ code: "ABORTED" });
    expect(budget.used).toBe(1);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a pending backoff immediately without leaking a listener or sending a retry", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    mocks.generate.mockRejectedValue(Object.assign(new Error("Network error"), { statusCode: 503 }));
    const budget = new ModelCallBudget(3);
    const solver = new VercelAiSolverProvider(profile, "test", "unused", budget);
    const outcome = solver.solve(batch, { strategy: "unattended", allow_images: false }, [], controller.signal).catch(error => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();
    expect(await outcome).toMatchObject({ code: "ABORTED" });
    expect(budget.used).toBe(1);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("removes settled backoff listeners and counts every failed retry", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    mocks.generate.mockRejectedValue(Object.assign(new Error("Network error"), { statusCode: 503 }));
    const budget = new ModelCallBudget(3);
    const solver = new VercelAiSolverProvider(profile, "test", "unused", budget);
    const outcome = solver.solve(batch, { strategy: "unattended", allow_images: false }, [], controller.signal).catch(error => error);
    await vi.runAllTimersAsync();
    expect(await outcome).toMatchObject({ code: "NETWORK" });
    expect(budget.used).toBe(3);
    expect(add).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops a three-attempt network retry at the default 300-call boundary", async () => {
    vi.useFakeTimers();
    const budget = new ModelCallBudget();
    for (let i = 0; i < 299; i++) budget.consume();
    mocks.generate.mockRejectedValue(Object.assign(new Error("Network error"), { statusCode: 503 }));
    const solver = new VercelAiSolverProvider(profile, "test", "unused", budget);
    const outcome = solver.solve(batch, { strategy: "unattended", allow_images: false }, []).catch(error => error);
    await vi.runAllTimersAsync();
    expect(await outcome).toMatchObject({ name: "ModelCallLimitError", limit: 300 });
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(budget.used).toBe(300);
    expect(budget.remaining).toBe(0);
  });
});
