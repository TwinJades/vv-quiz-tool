// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { buildAnswerExecutionPlan, ModelCallBudget, QuizOrchestrator } from "../../src/core";
import type { AnswerResult, BatchAnswerResult, QuestionBatch } from "../../src/core";
import { DomWebAdapter } from "../../src/web/dom-adapter";
import { WebVerifier } from "../../src/web/verifier";
const signal = () => new AbortController().signal;
class PagePlatform extends DomWebAdapter {
  override async waitUntilReady() { return { ready: true }; }
  async resolveMedia(handles: string[] = []) { return handles.map(handle => ({ temporary_handle: handle, mime_type: "image/png", data: new Uint8Array([1]) })); }
}
function mount(count = 2) {
  document.body.innerHTML = `<form>${Array.from({ length: count }, (_, i) => `<fieldset><legend>Question ${i + 1}: choose B</legend><label><input type="radio" name="q${i}" value="a">A</label><label><input type="radio" name="q${i}" value="b">B</label></fieldset>`).join("")}<button type="button">Submit quiz</button></form>`;
}
afterEach(() => { document.body.innerHTML = ""; });
describe("whole-page DOM execution", () => {
  it("verifies a submitted personal score while all question cards remain for review", async () => {
    mount(2); const platform = new PagePlatform(document); let submissions = 0;
    document.querySelector("button")!.addEventListener("click", () => {
      submissions++;
      document.querySelectorAll<HTMLInputElement>("input").forEach(input => { input.disabled = true; });
      document.querySelector("button")!.remove();
      document.body.insertAdjacentHTML("afterbegin", '<section><div><strong>1 / 2</strong></div><p>Your score for today\'s quiz</p></section>');
    });
    const solver = { async solve(batch: QuestionBatch): Promise<BatchAnswerResult> {
      return { schema_version: "1.0", session_id: batch.session_id, batch_id: batch.batch_id, errors: [], answers: batch.questions.map(question => ({ schema_version: "1.0", session_id: "s", question_id: question.question_id, observation_id: question.observation_id, answer_type: question.type, status: "answered", selected_option_ids: [question.options[1]!.id], blank_answers: [], confidence: 1, warnings: [] })) };
    } };
    const runner = new QuizOrchestrator(platform, solver, new WebVerifier(), { session_id: "s", strategy: "unattended", observation_input_mode: "semantic_snapshot", provider_profile_id: "p", model_id: "fixture", image_upload_authorized: false, wait: async () => {} });
    await runner.run();
    expect(runner.snapshot().state).toBe("COMPLETE");
    expect(runner.snapshot().summary).toMatchObject({ total: 2, answered: 2, visible_score: "1/2" });
    expect(submissions).toBe(1); expect(document.querySelectorAll("fieldset")).toHaveLength(2);
  });

  it("does not interpret a personal score preview as terminal while answers are editable", async () => {
    mount(); document.body.insertAdjacentHTML("afterbegin", '<section><strong>1/2</strong><p>Your score</p></section>');
    const platform = new PagePlatform(document); await platform.observeSession("s", signal());
    expect((await platform.readState(signal())).completed).toBe(false);
    document.querySelector("button")!.remove();
    expect((await platform.readState(signal())).completed).toBe(false);
  });

  it("ignores hidden score templates, introductory prose and ambiguous personal ratios", async () => {
    mount(); const platform = new PagePlatform(document); await platform.observeSession("s", signal());
    document.querySelectorAll<HTMLInputElement>("input").forEach(input => { input.disabled = true; });
    document.querySelector("button")!.remove();
    for (const html of [
      '<section hidden><strong class="score">1/2</strong><p>Your score</p></section>',
      '<section><strong>1/2</strong><p>After you submit your answers you will see your score</p></section>',
      '<section><strong>3/2</strong><p>Your score</p></section>',
      '<section><strong>1/2</strong><strong>2/2</strong><p>Your score</p></section>',
    ]) {
      const result = document.createElement("aside"); result.innerHTML = html; document.body.prepend(result);
      expect((await platform.readState(signal())).completed).toBe(false);
      result.remove();
    }
  });

  it("inventories styled question cards and keeps their DIV title separate from option labels", async () => {
    document.body.innerHTML = `<form>${Array.from({length:10},(_,i)=>`<div class="question-card" data-question-id="${i}"><div class="question-title">${i+1}. Choose B?</div><label><input type="radio" name="q${i}" value="a">A</label><label><input type="radio" name="q${i}" value="b">B</label></div>`).join("")}<button type="submit">Submit Answers</button></form>`;
    const platform = new PagePlatform(document); const observed = await platform.observeSession("s", signal());
    expect(observed.questions).toHaveLength(10); expect(observed.question_total).toBe(10);
    expect(observed.questions.map(item => item.question.stem.text)).toEqual(Array.from({length:10},(_,i)=>`${i+1}. Choose B?`));
    expect(observed.questions.every(item => item.question.options.length === 2 && item.question.type === "single_choice")).toBe(true);
  });
  it("separates named radio groups in plain containers with their own stems", async () => {
    document.body.innerHTML = `<form>${Array.from({length:3},(_,i)=>`<section class="exercise-item"><p>Question ${i+1}: Choose B?</p><div class="answers"><label><input type="radio" name="q${i}" value="a">A</label><label><input type="radio" name="q${i}" value="b">B</label></div></section>`).join("")}<button type="button">Submit Answers</button></form>`;
    const platform = new PagePlatform(document); const observed = await platform.observeSession("s", signal());
    expect(observed.layout).toBe("multi_question_page"); expect(observed.questions).toHaveLength(3);
    expect(observed.questions.map(item => item.question.stem.text)).toEqual(["Question 1: Choose B?", "Question 2: Choose B?", "Question 3: Choose B?"]);
    expect(observed.questions.every(item => item.question.options.length === 2)).toBe(true);
    expect(Object.keys(observed.questions[0]!.locator_map.targets)).toContain("page_1_control_submit_session");
  });

  it("rejects unseparable named groups instead of merging many questions into one", async () => {
    document.body.innerHTML = '<form><h2>Mixed question layout</h2><label><input type="radio" name="q1">A</label><label><input type="radio" name="q2">X</label><label><input type="radio" name="q1">B</label><label><input type="radio" name="q2">Y</label><button>Submit quiz</button></form>';
    await expect(new PagePlatform(document).observeSession("s", signal())).rejects.toThrow("ambiguous_native_question_groups");
  });
  it("isolates identical local option IDs and refuses cross-question or stale actions", async () => {
    mount(); const platform = new PagePlatform(document); const observation = await platform.observeSession("s", signal());
    expect(observation.questions).toHaveLength(2);
    const first = observation.questions[0]!; const second = observation.questions[1]!;
    const answer: AnswerResult = { schema_version: "1.0", session_id: "s", question_id: first.question.question_id, observation_id: observation.observation_id, answer_type: "single_choice", status: "answered", selected_option_ids: [first.question.options[1]!.id], blank_answers: [], confidence: 1, warnings: [] };
    const plan = buildAnswerExecutionPlan(first.question, answer, first.locator_map, "unattended");
    await platform.execute(plan, first.locator_map, signal());
    expect((document.querySelector('input[name="q0"][value="b"]') as HTMLInputElement).checked).toBe(true);
    expect((document.querySelector('input[name="q1"][value="b"]') as HTMLInputElement).checked).toBe(false);
    const crossed = { ...plan, actions: [{ ...plan.actions[0]!, target_id: second.question.options[0]!.id }] };
    await expect(platform.execute(crossed, first.locator_map, signal())).rejects.toThrow("another question");
    await platform.observeSession("s", signal());
    await expect(platform.execute(plan, first.locator_map, signal())).rejects.toThrow("mismatch");
  });

  it("batches six questions, retries only one invalid answer and submits the whole form once", async () => {
    mount(6); const platform = new PagePlatform(document); let submissions = 0;
    document.querySelector("button")!.addEventListener("click", () => { submissions++; document.body.innerHTML = '<h1>Test complete</h1><p class="score">6/6</p>'; });
    const budget = new ModelCallBudget(); const requested: string[][] = [];
    const solver = { async solve(batch: QuestionBatch): Promise<BatchAnswerResult> {
      budget.consume(); requested.push([...batch.question_ids]);
      return { schema_version: "1.0", session_id: batch.session_id, batch_id: batch.batch_id, errors: [], answers: [...batch.questions].reverse().map(question => ({ schema_version: "1.0", session_id: "s", question_id: question.question_id, observation_id: question.observation_id, answer_type: question.type, status: "answered", selected_option_ids: [requested.length === 1 && question.question_id.startsWith("page_2_") ? "outside" : question.options[1]!.id], blank_answers: [], confidence: 1, warnings: [] })) };
    } };
    const runner = new QuizOrchestrator(platform, solver, new WebVerifier(), { session_id: "s", strategy: "unattended", observation_input_mode: "semantic_snapshot", provider_profile_id: "p", model_id: "fixture", image_upload_authorized: false, model_call_budget: budget, wait: async () => {} });
    await runner.run();
    expect(runner.snapshot().state).toBe("COMPLETE");
    expect(requested.map(batch => batch.length)).toEqual([5, 1, 1]);
    expect(requested[2]![0]).toContain("page_2_");
    expect(submissions).toBe(1);
    expect(runner.snapshot().summary).toMatchObject({ total: 6, answered: 6, retried: 1, model_calls: 3, visible_score: "6/6" });
  });

  it("executes mixed single-choice, multiple-choice, image and fill-blank fields before unified submission", async () => {
    document.body.innerHTML = `<form><fieldset><legend>Choose B</legend><img src="https://example.test/diagram.png" width="20" height="20"><label><input type="radio" name="single" value="a">A</label><label><input type="radio" name="single" value="b">B</label></fieldset><fieldset><legend>Select A and B</legend><label><input type="checkbox" name="multi" value="a">A</label><label><input type="checkbox" name="multi" value="b">B</label><label><input type="checkbox" name="multi" value="c">C</label></fieldset><fieldset><legend>Capital of France?</legend><input type="text" aria-label="Capital" required></fieldset><button type="button">Submit quiz</button></form>`;
    const platform = new PagePlatform(document);
    const observed = await platform.observeSession("s", signal());
    expect(observed.questions.map(item => item.question.type)).toEqual(["multiple_choice", "single_choice", "fill_blank"]);
    // Root scoring order is local only; answer association must use IDs/type.
    let finalValues: unknown;
    document.querySelector("button")!.addEventListener("click", () => {
      finalValues = { single: (document.querySelector('input[name="single"][value="b"]') as HTMLInputElement).checked, multi: [...document.querySelectorAll<HTMLInputElement>('input[name="multi"]')].map(input => input.checked), blank: (document.querySelector('input[type="text"]') as HTMLInputElement).value };
      document.body.innerHTML = '<h1>Test complete</h1><p class="score">3/3</p>';
    });
    const solver = { async solve(batch: QuestionBatch): Promise<BatchAnswerResult> {
      return { schema_version: "1.0", session_id: batch.session_id, batch_id: batch.batch_id, errors: [], answers: batch.questions.map(question => ({ schema_version: "1.0", session_id: "s", question_id: question.question_id, observation_id: question.observation_id, answer_type: question.type, status: "answered", selected_option_ids: question.type === "single_choice" ? [question.options[1]!.id] : question.type === "multiple_choice" ? question.options.slice(0, 2).map(option => option.id) : [], blank_answers: question.blanks.map(blank => ({ blank_id: blank.id, value: "Paris" })), confidence: 1, warnings: [] })) };
    } };
    const runner = new QuizOrchestrator(platform, solver, new WebVerifier(), { session_id: "s", strategy: "unattended", observation_input_mode: "semantic_snapshot", provider_profile_id: "p", model_id: "fixture", image_upload_authorized: true, wait: async () => {} });
    await runner.run();
    expect(runner.snapshot().state).toBe("COMPLETE");
    expect(finalValues).toEqual({ single: true, multi: [true, true, false], blank: "Paris" });
  });
});
