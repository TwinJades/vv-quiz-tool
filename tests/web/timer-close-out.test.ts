// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuizOrchestrator } from "../../src/core";
import type { BatchAnswerResult, QuestionBatch, RuntimeMediaPayload } from "../../src/core";
import { DomWebAdapter } from "../../src/web/dom-adapter";
import { WebVerifier } from "../../src/web/verifier";

class PagePlatform extends DomWebAdapter {
  override async waitUntilReady() { return { ready: true }; }
  async resolveMedia(_handles: string[] = [], _signal?: AbortSignal): Promise<RuntimeMediaPayload[]> { return []; }
}
function answer(batch: QuestionBatch, invalid = false): BatchAnswerResult {
  return { schema_version: "1.0", session_id: batch.session_id, batch_id: batch.batch_id, errors: [], answers: batch.questions.map(q => ({ schema_version: "1.0", session_id: q.session_id, question_id: q.question_id, observation_id: q.observation_id, answer_type: q.type, status: "answered", selected_option_ids: [invalid ? "outside" : q.options[1]!.id], blank_answers: [], confidence: 1, warnings: [] })) };
}
function mount(seconds: number, count = 2) {
  document.body.innerHTML = `<span role="timer" data-remaining-seconds="${seconds}"></span><form>${Array.from({length:count},(_,i)=>`<fieldset><legend>Question ${i+1}: choose B</legend><label><input type="radio" name="q${i}" value="a">A</label><label><input type="radio" name="q${i}" value="b">B</label></fieldset>`).join("")}<button type="button">Submit quiz</button></form>`;
  const result = { submissions: 0, selected: 0 };
  document.querySelector("button")!.addEventListener("click", () => {
    result.submissions++; result.selected = document.querySelectorAll('input[value="b"]:checked').length;
    document.body.innerHTML = `<h1>Test complete</h1><p class="score">${result.selected}/${count}</p>`;
  });
  return result;
}
const options = { session_id: "s", strategy: "unattended" as const, observation_input_mode: "structured" as const, provider_profile_id: "p", model_id: "fixture", image_upload_authorized: false, wait: async () => {} };
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });

describe("dynamic timer close-out", () => {
  it.each(["unattended"] as const)("closes %s while a required image fetch hangs and ignores its late payload", async strategy => {
    vi.useFakeTimers(); const website = mount(120); const platform = new PagePlatform(document);
    document.querySelector("fieldset")!.insertAdjacentHTML("afterbegin", '<img src="https://example.test/diagram.png" width="16" height="16">');
    let mediaSignal: AbortSignal | undefined; let fetches = 0; let solves = 0; let release!: () => void;
    platform.resolveMedia = async (_handles, signal) => { fetches++; mediaSignal = signal; return new Promise(resolve => { release = () => resolve([{ temporary_handle: "late", mime_type: "image/png", data: new Uint8Array([1]) }]); }); };
    const runner = new QuizOrchestrator(platform, { solve: async batch => { solves++; return answer(batch); } }, new WebVerifier(), { ...options, strategy, image_upload_authorized: true, now: () => Date.now() });
    const running = runner.run(); await vi.waitFor(() => expect(fetches).toBe(1));
    document.querySelector('[role="timer"]')!.setAttribute("data-remaining-seconds", "1");
    await vi.advanceTimersByTimeAsync(600); await running;
    expect(mediaSignal?.aborted).toBe(true); expect(solves).toBe(0);
    expect(website).toEqual({ submissions: 1, selected: 0 });
    expect(runner.snapshot()).toMatchObject({ state: "COMPLETE", progress: { answered: 0, skipped: 2 } });
    release(); await Promise.resolve(); expect(solves).toBe(0); expect(website.submissions).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles a pause during uncooperative media with no initially observed timer", async () => {
    const website = mount(120); document.querySelector('[role="timer"]')!.remove();
    document.querySelector("fieldset")!.insertAdjacentHTML("afterbegin", '<img src="https://example.test/diagram.png" width="16" height="16">');
    const platform = new PagePlatform(document); let fetches = 0; let mediaSignal: AbortSignal | undefined;
    platform.resolveMedia = async (_handles, signal) => { fetches++; mediaSignal = signal; return new Promise(() => {}); };
    const runner = new QuizOrchestrator(platform, { solve: async batch => answer(batch) }, new WebVerifier(), options);
    const running = runner.run(); await vi.waitFor(() => expect(fetches).toBe(1)); runner.pause("Manual test"); await running;
    expect(mediaSignal?.aborted).toBe(true); expect(runner.snapshot().state).toBe("PAUSED"); expect(website.submissions).toBe(0);
  });

  it("observes a newly appearing deadline during a hung media fetch", async () => {
    vi.useFakeTimers(); const website = mount(120); document.querySelector('[role="timer"]')!.remove();
    document.querySelector("fieldset")!.insertAdjacentHTML("afterbegin", '<img src="https://example.test/diagram.png" width="16" height="16">');
    const platform = new PagePlatform(document); let fetches = 0;
    platform.resolveMedia = async () => { fetches++; return new Promise(() => {}); };
    const runner = new QuizOrchestrator(platform, { solve: async batch => answer(batch) }, new WebVerifier(), { ...options, now: () => Date.now() });
    const running = runner.run(); await vi.waitFor(() => expect(fetches).toBe(1));
    document.body.insertAdjacentHTML("afterbegin", '<span role="timer" data-remaining-seconds="1"></span>');
    await vi.advanceTimersByTimeAsync(600); await running;
    expect(runner.snapshot().state).toBe("COMPLETE"); expect(website.submissions).toBe(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("does not start a model or send a late submit after an observed zero deadline", async () => {
    const website = mount(0); let requests = 0;
    const runner = new QuizOrchestrator(new PagePlatform(document), { solve: async batch => { requests++; return answer(batch); } }, new WebVerifier(), options);
    await runner.run();
    expect(requests).toBe(0); expect(website.submissions).toBe(0);
    expect(runner.snapshot()).toMatchObject({ state: "PAUSED" });
  });
  it("prioritizes untouched batches over retries and submits only validated answers", async () => {
    const website = mount(80, 3); let now = 0; const requested: string[][] = []; const policies: boolean[] = [];
    const runner = new QuizOrchestrator(new PagePlatform(document), {
      batchLimits: () => ({ max_questions: 1, max_estimated_tokens: 12000, max_images: 0 }),
      solve: async (batch, policy) => {
        requested.push(batch.question_ids); policies.push(Boolean(policy.allow_native_search));
        if (requested.length === 2) now = 45000;
        return answer(batch, requested.length === 2);
      },
    }, new WebVerifier(), { ...options, now: () => now, allow_native_search: true });
    await runner.run();
    expect(requested).toHaveLength(3); expect(new Set(requested.flat()).size).toBe(3);
    expect(policies).toEqual([true, true, false]);
    expect(website).toEqual({ submissions: 1, selected: 2 });
    expect(runner.snapshot()).toMatchObject({ state: "COMPLETE", progress: { answered: 2, skipped: 1, retried: 0 }, summary: { visible_score: "2/3" } });
  });
  it("cancels a hung request at the submit reserve and ignores a later answer", async () => {
    vi.useFakeTimers(); const website = mount(6); let requested = 0; let requestSignal: AbortSignal | undefined;
    let release!: () => void;
    const runner = new QuizOrchestrator(new PagePlatform(document), { solve: async (batch, _policy, _media, signal) => {
      requested++; requestSignal = signal;
      await new Promise<void>(resolve => { release = resolve; }); return answer(batch);
    } }, new WebVerifier(), { ...options, now: () => Date.now() });
    const running = runner.run();
    await vi.waitFor(() => expect(requested).toBe(1));
    await vi.advanceTimersByTimeAsync(1200); await running;
    expect(requestSignal?.aborted).toBe(true);
    expect(website).toEqual({ submissions: 1, selected: 0 });
    expect(runner.snapshot()).toMatchObject({ state: "COMPLETE", progress: { answered: 0, skipped: 2 } });
    release(); await Promise.resolve();
    expect(website.selected).toBe(0); expect(runner.snapshot().state).toBe("COMPLETE");
  });
  it("refreshes a shortening DOM deadline while the model request is pending", async () => {
    vi.useFakeTimers(); const website = mount(120); let requested = 0; let requestSignal: AbortSignal | undefined;
    const states: string[] = [];
    const runner = new QuizOrchestrator(new PagePlatform(document), { solve: async (_batch, _policy, _media, signal) => {
      requested++; requestSignal = signal; return new Promise<BatchAnswerResult>(() => {});
    } }, new WebVerifier(), { ...options, now: () => Date.now(), on_update: snapshot => states.push(snapshot.state) });
    const running = runner.run(); await vi.waitFor(() => expect(requested).toBe(1));
    document.querySelector('[role="timer"]')!.setAttribute("data-remaining-seconds", "1");
    await vi.advanceTimersByTimeAsync(600); await running;
    expect(states).toContain("CLOSE_OUT"); expect(requestSignal?.aborted).toBe(true);
    expect(website.submissions).toBe(1); expect(runner.snapshot().state).toBe("COMPLETE");
  });
  it("settles a manual pause without waiting for an uncooperative pending model", async () => {
    vi.useFakeTimers(); const website = mount(120); let requested = 0;
    const runner = new QuizOrchestrator(new PagePlatform(document), { solve: async () => { requested++; return new Promise<BatchAnswerResult>(() => {}); } }, new WebVerifier(), { ...options, now: () => Date.now() });
    const running = runner.run(); await vi.waitFor(() => expect(requested).toBe(1));
    runner.pause("Manual test"); await running;
    expect(runner.snapshot().state).toBe("PAUSED"); expect(website.submissions).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
