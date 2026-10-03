// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";

import { buildAnswerExecutionPlan, SCHEMA_VERSION } from "../../src/core";
import type { AnswerResult } from "../../src/core";
import { DomWebAdapter } from "../../src/web/dom-adapter";
import { WebVerifier } from "../../src/web/verifier";

function abortSignal(): AbortSignal {
  return new AbortController().signal;
}

afterEach(() => {
  document.body.innerHTML = "";
  document.title = "";
});

describe("DomWebAdapter", () => {
  it.each(['radio','checkbox'] as const)('retains a graded H5P MultiChoice %s question when roles and Check are removed',async role=>{
    document.body.innerHTML=`<div class="questionset"><section class="h5p-question h5p-multichoice"><p>Choose a topic.</p><div class="h5p-question-content ${role==='radio'?'h5p-radio':'h5p-check'}"><ul class="h5p-answers"><li role="${role}" class="h5p-answer"><span class="h5p-alternative-inner">First</span></li><li role="${role}" class="h5p-answer"><span class="h5p-alternative-inner">Second</span></li></ul></div><button class="h5p-question-check-answer">Check</button><div class="h5p-question-scorebar"></div></section></div>`;
    const adapter=new DomWebAdapter(document);
    const before=await adapter.observeSession('last-multichoice',abortSignal());
    document.querySelectorAll('.h5p-answer').forEach(e=>{e.removeAttribute('role');e.setAttribute('aria-disabled','true');});
    document.querySelector('.h5p-answer')!.insertAdjacentHTML('beforeend','<span class="h5p-answer-icon">Correct answer.</span><div class="h5p-feedback-dialog">Long grading feedback, not an option.</div>');
    document.querySelector('.h5p-question-check-answer')!.remove();
    const score=document.querySelector<HTMLElement>('.h5p-question-scorebar')!;score.classList.add('h5p-question-visible');score.textContent='You got 1 out of 1 points';
    const state=await adapter.readState(abortSignal());
    expect(state).toMatchObject({fingerprint:before.fingerprint,feedback:'correct',completed:false});
    document.querySelector('section')!.insertAdjacentHTML('beforeend','<button class="h5p-question-finish">Finish</button>');
    const graded=await adapter.observeSession('last-multichoice',abortSignal());
    expect(graded.fingerprint).toBe(before.fingerprint);
    expect(graded.questions[0]!.locator_map.targets.control_submit_session).toBeDefined();
    expect(graded.questions[0]!.locator_map.targets.control_submit).toBeUndefined();
    expect(graded.questions[0]!.question.type).toBe(role==='radio'?'single_choice':'multiple_choice');
    expect(graded.questions[0]!.question.options.map(o=>o.text)).toEqual(['First','Second']);
    const item=graded.questions[0]!;
    expect(await adapter.execute({schema_version:SCHEMA_VERSION,session_id:'last-multichoice',question_id:item.question.question_id,observation_id:graded.observation_id,strategy:'unattended',actions:[{action_id:'unsafe',kind:'set_selected',target_id:'opt_1',value:true}],preconditions:['same_surface','same_question_fingerprint','target_available']},item.locator_map,abortSignal())).toMatchObject([{status:'failed'}]);
    document.querySelector('.h5p-alternative-inner')!.textContent='Changed option';
    expect((await adapter.readState(abortSignal())).fingerprint).not.toBe(before.fingerprint);
  });
  it('uses the current H5P live grade while the scorebar still animates the previous attempt',async()=>{
    document.body.innerHTML='<div class="questionset"><section class="h5p-question"><p>A lesson lasts <input type="text"> minutes.</p><div class="h5p-question-scorebar h5p-question-visible"><div class="h5p-joubelui-score-bar-progress">You got 0 out of 1 points</div></div><div class="h5p-hidden-read" aria-live="polite">You got 1 out of 1 points.</div><a aria-label="Next question"></a></section><section class="h5p-question" hidden><div class="h5p-hidden-read" aria-live="polite">You got 0 out of 1 points.</div></section></div>';
    const adapter=new DomWebAdapter(document);
    await adapter.observeSession('grade-animation',abortSignal());
    expect(await adapter.readState(abortSignal())).toMatchObject({feedback:'correct',completed:false});
    const live=document.querySelector<HTMLElement>('.h5p-hidden-read')!;
    const bar=document.querySelector<HTMLElement>('.h5p-joubelui-score-bar-progress')!;
    bar.textContent='You got 1 out of 1 points';live.textContent='You got 0 out of 1 points.';
    expect((await adapter.readState(abortSignal())).feedback).toBe('incorrect');
    // Once the local announcement clears, use the actual local scorebar. A
    // hidden other question and an unrelated page announcement cannot override it.
    live.textContent='';
    document.body.insertAdjacentHTML('beforeend','<div aria-live="polite">You got 0 out of 1 points.</div>');
    expect((await adapter.readState(abortSignal())).feedback).toBe('correct');
    document.querySelector('.h5p-question-scorebar')!.classList.remove('h5p-question-visible');
    live.textContent='You got 0 out of 1 points.';
    expect((await adapter.readState(abortSignal())).feedback).toBeNull();
  });
  it('still recognizes the final score of a standalone H5P activity whose choices are disabled',async()=>{
    document.body.innerHTML='<section class="h5p-question"><p>Select the pictures.</p><div role="checkbox">First</div><div role="checkbox">Second</div><button class="h5p-question-check-answer">Check</button><div class="h5p-question-scorebar"></div></section>';
    const adapter=new DomWebAdapter(document);
    await adapter.observeSession('standalone',abortSignal());
    document.querySelectorAll('[role=checkbox]').forEach(e=>e.setAttribute('aria-disabled','true'));
    document.querySelector('.h5p-question-check-answer')!.remove();
    const score=document.querySelector<HTMLElement>('.h5p-question-scorebar')!;score.classList.add('h5p-question-visible');score.textContent='You got 4 out of 4 points';
    expect(await adapter.readState(abortSignal())).toMatchObject({completed:true,visible_score:'4/4'});
  });
  it('reobserves disabled H5P true/false choices to bind a dynamically created Retry without changing question identity',async()=>{
    document.body.innerHTML=`<div class="questionset"><section class="h5p-question"><p>Complete both sessions.</p><div role="radio" class="h5p-true-false-answer">True<span class="aria-label"></span></div><div role="radio" class="h5p-true-false-answer">False<span class="aria-label"></span></div><button class="h5p-question-check-answer">Check</button><div class="h5p-question-feedback"></div><a class="h5p-question-next" aria-label="Next question"></a></section></div>`;
    const adapter=new DomWebAdapter(document);
    const before=await adapter.observeSession('tf-retry',abortSignal());
    document.querySelectorAll('[role=radio]').forEach(element=>element.setAttribute('aria-disabled','true'));
    document.querySelectorAll('.aria-label')[1]!.textContent='.Wrong answer';
    document.querySelector('.h5p-question-check-answer')!.remove();
    const feedback=document.querySelector<HTMLElement>('.h5p-question-feedback')!;
    feedback.classList.add('h5p-question-visible');feedback.textContent='You got 0 of 1 points';
    document.querySelector('section')!.insertAdjacentHTML('beforeend','<button class="h5p-question-try-again">Retry<span class="hidden-but-read">Retry the task. Reset all responses and start over.</span></button>');
    expect(await adapter.readState(abortSignal())).toMatchObject({fingerprint:before.fingerprint,feedback:'incorrect',can_retry:true,completed:false});
    const graded=await adapter.observeSession('tf-retry',abortSignal());
    expect(graded.fingerprint).toBe(before.fingerprint);
    expect(graded.questions[0]!.question.options.map(o=>o.text)).toEqual(['True','False']);
    const retry=document.querySelector<HTMLElement>('.h5p-question-try-again')!;
    retry.addEventListener('click',()=>{document.querySelectorAll('[role=radio]').forEach(e=>e.removeAttribute('aria-disabled'));document.querySelectorAll('.aria-label').forEach(e=>e.textContent='');feedback.classList.remove('h5p-question-visible');feedback.textContent='';retry.remove();});
    const item=graded.questions[0]!;
    expect(await adapter.execute({schema_version:SCHEMA_VERSION,session_id:'tf-retry',question_id:item.question.question_id,observation_id:graded.observation_id,strategy:'unattended',actions:[{action_id:'retry',kind:'retry_question',target_id:'control_retry'}],preconditions:['same_surface','same_question_fingerprint','target_available']},item.locator_map,abortSignal())).toMatchObject([{status:'succeeded'}]);
    expect((await adapter.observeSession('tf-retry',abortSignal())).fingerprint).toBe(before.fingerprint);
    expect((await adapter.readState(abortSignal())).feedback).toBeNull();
  });
  it('keeps H5P fill grading announcements out of question identity and retries visible scorebar failures',async()=>{
    document.body.innerHTML=`<div class="questionset"><section class="h5p-question"><p>Fill in the missing word.</p><div class="hidden-but-read"></div><p>A lesson lasts <span class="h5p-input-wrapper"><input type="text" aria-label="Blank input 1 of 1"></span> minutes.</p><button class="h5p-question-check-answer">Check</button><div class="h5p-question-feedback"></div><div class="h5p-question-scorebar" hidden><div class="h5p-joubelui-score-bar-progress">You got 0 out of 1 points</div><svg><title>star</title></svg><span>0/1</span></div><a class="h5p-question-next" aria-label="Next question"></a></section><section class="h5p-question" hidden><input type="text"><div class="h5p-question-scorebar h5p-question-visible">You got 1 out of 1 points</div></section></div>`;
    const adapter=new DomWebAdapter(document);
    const initial=await adapter.observeSession('fill-retry',abortSignal());
    const fingerprint=initial.fingerprint;
    expect((await adapter.readState(abortSignal())).feedback).toBeNull();
    const field=document.querySelector<HTMLInputElement>('input')!;
    field.value='3';field.setAttribute('aria-label','Blank input 1 of 1. Answered incorrectly');
    const announcement=document.querySelector<HTMLElement>('.hidden-but-read')!;announcement.textContent='Checking mode';
    const scorebar=document.querySelector<HTMLElement>('.h5p-question-scorebar')!;scorebar.hidden=false;scorebar.classList.add('h5p-question-visible');
    const root=field.closest('section')!;
    root.insertAdjacentHTML('beforeend','<button class="h5p-question-try-again" aria-label="Retry the task. Reset all responses and start over.">Retry</button>');
    expect(await adapter.readState(abortSignal())).toMatchObject({fingerprint,feedback:'incorrect',can_retry:true,completed:false});
    const graded=await adapter.observeSession('fill-retry',abortSignal());
    expect(graded.fingerprint).toBe(fingerprint);
    expect(graded.questions[0]!.question.stem.text).not.toContain('Checking mode');
    root.querySelector('.h5p-question-try-again')!.addEventListener('click',()=>{field.value='';field.setAttribute('aria-label','Blank input 1 of 1');announcement.textContent='';scorebar.hidden=true;});
    const item=graded.questions[0]!;
    const actions=await adapter.execute({schema_version:SCHEMA_VERSION,session_id:'fill-retry',question_id:item.question.question_id,observation_id:graded.observation_id,strategy:'unattended',actions:[{action_id:'retry',kind:'retry_question',target_id:'control_retry'}],preconditions:['same_surface','same_question_fingerprint','target_available']},item.locator_map,abortSignal());
    expect(actions).toMatchObject([{status:'succeeded'}]);
    await adapter.observeSession('fill-retry',abortSignal());
    expect(await adapter.readState(abortSignal())).toMatchObject({fingerprint,feedback:null,field_values:{blank_1:''},completed:false});
    // Correct H5P blanks become disabled, while Next still belongs to this
    // question; disabling must not manufacture a zero-blank "new question".
    field.disabled=true;announcement.textContent='Checking mode';
    scorebar.hidden=false;scorebar.querySelector('.h5p-joubelui-score-bar-progress')!.textContent='You got 1 out of 1 points';
    expect(await adapter.readState(abortSignal())).toMatchObject({fingerprint,feedback:'correct',completed:false});
    const correct=await adapter.observeSession('fill-retry',abortSignal());
    expect(correct.fingerprint).toBe(fingerprint);
    expect(correct.questions[0]!.question.blanks).toHaveLength(1);
    // A real change to the visible lesson question remains a stale-binding stop.
    root.querySelectorAll('p')[1]!.prepend('Different question: ');
    expect((await adapter.readState(abortSignal())).fingerprint).not.toBe(fingerprint);
  });
  it('keeps a graded H5P question open with an empty next arrow and accessible eight-question progress',async()=>{
    document.body.innerHTML='<div class="questionset"><div class="h5p-question"><p>Complete both sessions.</p><div role="radio" aria-label="True" aria-checked="false">True</div><div role="radio" aria-label="False" aria-checked="false">False</div><button class="h5p-question-check-answer">Check</button><div class="h5p-question-feedback h5p-question-visible" hidden></div><a href="#" class="h5p-question-next" aria-label="Next question"></a></div><nav>'+Array.from({length:8},(_,i)=>'<a class="progress-dot '+(i===0?'current':'')+'" aria-label="Question '+(i+1)+' of 8, '+(i===0?'Current question':'Unanswered')+'"></a>').join('')+'</nav></div>';
    const adapter=new DomWebAdapter(document);
    const observation=await adapter.observeSession('s',abortSignal());
    expect(observation.question_total).toBe(8);
    const item=observation.questions[0]!;
    expect(item.locator_map.targets.control_next).toBeDefined();
    document.querySelectorAll('[role=radio]').forEach(element=>element.setAttribute('aria-disabled','true'));
    document.querySelector('.h5p-question-check-answer')!.remove();
    const feedback=document.querySelector<HTMLElement>('.h5p-question-feedback')!;feedback.hidden=false;feedback.textContent='You got 1 of 1 points';
    expect(await adapter.readState(abortSignal())).toMatchObject({completed:false,feedback:'correct',has_next:true,at_last_question:false,fingerprint:item.locator_map.question_fingerprint});
    feedback.textContent='You got 0 of 1 points';
    expect((await adapter.readState(abortSignal())).feedback).toBe('incorrect');
    feedback.textContent='You got 1 of 2 points';
    expect((await adapter.readState(abortSignal())).feedback).toBe('partial');
    feedback.hidden=true;
    expect((await adapter.readState(abortSignal())).feedback).toBeNull();
    document.querySelector('.questionset')!.setAttribute('hidden','');
    document.body.insertAdjacentHTML('beforeend','<div class="questionset-results">You got 8 out of 8 points</div>');
    expect(await adapter.readState(abortSignal())).toMatchObject({completed:true,visible_score:'8/8'});
  });
  it.each([
    ['<span role="timer">0:00</span>',null],
    ['<span class="countdown" hidden>00:01</span>',null],
    ['<span class="timer">Elapsed time 01:05</span>',null],
    ['<span class="countdown" aria-label="Elapsed time">01:05</span>',null],
    ['<span class="countdown" data-timer-scope="question">00:20</span>',null],
    ['<span class="timer">Question time left 00:20</span>',null],
    ['<span class="timer">Time left 00:65</span>',null],
    ['<span class="timer">Time left 01:05</span>',65],
    ['<span class="countdown">00:00</span>',0],
    ['<span role="timer">Elapsed 01:05</span><span role="timer" aria-label="Time remaining">00:40</span>',40],
  ])('only uses an established session countdown: %s',async(markup,expected)=>{
    document.body.innerHTML=markup+'<fieldset><legend>Choose A</legend><label><input type="radio" name="q">A</label><label><input type="radio" name="q">B</label></fieldset><button>Check</button>';
    const adapter=new DomWebAdapter(document);
    expect((await adapter.observeSession('s',abortSignal())).timer_remaining_seconds).toBe(expected);
    expect((await adapter.readState(abortSignal())).timer_remaining_seconds).toBe(expected);
  });
  it("releases old question/media targets while preserving website answers and allowing a fresh observation", async () => {
    document.body.innerHTML = `<fieldset><legend>Choose A</legend><img src="https://example.test/q.png" width="20" height="20"><label><input type="radio" name="q" checked>A</label><label><input type="radio" name="q">B</label></fieldset><button>Check</button>`;
    const adapter = new DomWebAdapter(document);
    const observed = await adapter.observeSession("s", abortSignal());
    const item = observed.questions[0]!;
    const handle = item.question.stem.media[0]!.temporary_handle;
    const answer: AnswerResult = { schema_version: "1.0", session_id: "s", question_id: item.question.question_id, observation_id: observed.observation_id, answer_type: "single_choice", status: "answered", selected_option_ids: [item.question.options[1]!.id], blank_answers: [], confidence: 1, warnings: [] };
    const oldPlan = buildAnswerExecutionPlan(item.question, answer, item.locator_map, "unattended");
    expect(adapter.resolveMediaSource(handle)).toBeDefined();
    adapter.release();
    expect(adapter.resolveMediaSource(handle)).toBeUndefined();
    await expect(adapter.execute(oldPlan, item.locator_map, abortSignal())).rejects.toThrow();
    expect(document.querySelector<HTMLInputElement>("input")!.checked).toBe(true);
    const fresh = await adapter.observeSession("s", abortSignal());
    expect(fresh.observation_id).not.toBe(observed.observation_id);
    expect(fresh.questions).toHaveLength(1);
  });
  it("scopes manual interaction to quiz regions and bound external controls", async () => {
    document.body.innerHTML = `<nav><button id="menu">Menu</button></nav><fieldset><legend>Choose A</legend><label><input type="radio" name="q">A</label><label><input type="radio" name="q">B</label></fieldset><button id="check">Check</button>`;
    const adapter = new DomWebAdapter(document);
    expect(adapter.isQuizInteractionTarget(document.querySelector("input"))).toBe(true);
    expect(adapter.isQuizInteractionTarget(document.querySelector("#menu"))).toBe(false);
    await adapter.observeSession("s1", abortSignal());
    expect(adapter.isQuizInteractionTarget(document.querySelector("#check"))).toBe(true);
    expect(adapter.isQuizInteractionTarget(document.querySelector("#menu"))).toBe(false);
  });
  it("binds an external check button only when both the question and control are unique", async () => {
    const html = `<fieldset><legend>Choose A</legend><label><input type="radio" name="q">A</label><label><input type="radio" name="q">B</label></fieldset>`;
    document.body.innerHTML = html + `<button>Check</button>`;
    const observation = await new DomWebAdapter(document).observeSession("s1", abortSignal());
    expect(observation.questions[0]!.locator_map.targets.control_submit).toBeDefined();
    document.body.innerHTML = html + `<button>Check</button><button>Submit</button>`;
    const ambiguous = await new DomWebAdapter(document).observeSession("s1", abortSignal());
    expect(ambiguous.questions[0]!.locator_map.targets.control_submit).toBeUndefined();
  });
  it("does not bind a unique submit belonging to another form or page footer", async () => {
    const questionHtml = `<main><fieldset><legend>Choose A</legend><label><input type="radio" name="q">A</label><label><input type="radio" name="q">B</label></fieldset></main>`;
    for (const other of [`<form><button>Submit</button></form>`, `<footer><button>Check</button></footer>`]) {
      document.body.innerHTML = questionHtml + other;
      const observation = await new DomWebAdapter(document).observeSession("s1", abortSignal());
      expect(observation.questions[0]!.locator_map.targets.control_submit).toBeUndefined();
    }
  });

  it("recognizes a final result ratio and percentage without relying on the URL", async () => {
    document.body.innerHTML = "<main><h1>C Quiz</h1><h2>Result:</h2><p>24 of 25</p><p>96%</p></main>";
    expect(await new DomWebAdapter(document).readState(abortSignal())).toMatchObject({
      fingerprint: "missing", completed: true, visible_score: "24/25",
    });
  });

  it("does not mistake question text or inconsistent percentages for a final result", async () => {
    document.body.innerHTML = `<fieldset><legend>Result: 24 of 25 96%</legend><label><input type="radio" name="q">A</label><label><input type="radio" name="q">B</label></fieldset>`;
    expect((await new DomWebAdapter(document).readState(abortSignal())).completed).toBe(false);
    document.body.innerHTML = "<h2>Result:</h2><p>24 of 25</p><p>50%</p>";
    expect((await new DomWebAdapter(document).readState(abortSignal())).completed).toBe(false);
  });

  it("clears unselected options before clicking an answer that immediately changes the question", async () => {
    document.body.innerHTML = `<fieldset><legend>First question</legend><label><input type="radio" name="q">A</label><label><input type="radio" name="q">B</label><label><input type="radio" name="q">C</label></fieldset>`;
    const adapter = new DomWebAdapter(document);
    const observation = await adapter.observeSession("s1", abortSignal());
    const parsed = observation.questions[0]!;
    document.querySelector("input")!.addEventListener("click", () => {
      document.body.innerHTML = `<fieldset><legend>Second question</legend><label><input type="radio" name="next">X</label><label><input type="radio" name="next">Y</label></fieldset>`;
    });
    const plan = buildAnswerExecutionPlan(parsed.question, {
      schema_version: SCHEMA_VERSION, session_id: "s1", question_id: parsed.question.question_id,
      observation_id: observation.observation_id, answer_type: "single_choice", status: "answered",
      selected_option_ids: [parsed.question.options[0]!.id], blank_answers: [], confidence: 1, warnings: [],
    }, parsed.locator_map, "unattended");
    const results = await adapter.execute(plan, parsed.locator_map, abortSignal());
    expect(results.every(result => result.status === "succeeded")).toBe(true);
    expect(document.querySelector("legend")?.textContent).toBe("Second question");
    expect((await adapter.readState(abortSignal())).fingerprint).not.toBe(observation.fingerprint);
  });

  it("recognizes a score page after a submitted question disappears", async () => {
    document.body.innerHTML = "<main>You got 4 out of 4 points</main>";
    const state = await new DomWebAdapter(document).readState(abortSignal());
    expect(state).toMatchObject({ fingerprint: "missing", completed: true, visible_score: "4/4" });
  });

  it("pauses before answering a free-form essay", async () => {
    document.body.innerHTML = `<form class="question"><h2>Explain your answer.</h2><textarea></textarea><button>Submit</button></form>`;
    const adapter = new DomWebAdapter(document);
    await expect(adapter.waitUntilReady(abortSignal())).resolves.toMatchObject({
      ready: false,
      reason: "unsupported_subjective_question",
    });
    await expect(adapter.observeSession("essay", abortSignal())).rejects.toThrow("HARD_BLOCKER:unsupported_subjective_question");
    expect((document.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
  });

  it("keeps images inside ARIA choice controls", async () => {
    document.body.innerHTML = `<section class="question"><h2>Which icons are valid?</h2><ul>
      <li role="checkbox" aria-label="Icon A"><img src="https://example.com/a.png" alt="Icon A"></li>
      <li role="checkbox" aria-label="Icon B"><img src="https://example.com/b.png" alt="Icon B"></li>
    </ul></section>`;
    const observation = await new DomWebAdapter(document).observeSession("images", abortSignal());
    expect(observation.questions[0]?.question.type).toBe("multiple_choice");
    expect(observation.questions[0]?.question.options.map((option) => option.media.length)).toEqual([1, 1]);
  });

  it("verifies H5P single-choice controls that mark selection with a class", async () => {
    document.body.innerHTML = `<section class="question"><h2>Goji berries are also known as ...</h2>
      <ul role="radiogroup"><li role="radio" class="h5p-sc-alternative">Wolfberries</li>
      <li role="radio" class="h5p-sc-alternative">Bearberries</li></ul></section>`;
    const first = document.querySelector<HTMLElement>("[role='radio']")!;
    first.addEventListener("click", () => first.classList.add("h5p-sc-selected"));
    const adapter = new DomWebAdapter(document);
    const observation = await adapter.observeSession("h5p", abortSignal());
    const { question, locator_map: locatorMap } = observation.questions[0]!;
    const answer: AnswerResult = {
      schema_version: SCHEMA_VERSION,
      session_id: "h5p",
      question_id: question.question_id,
      observation_id: observation.observation_id,
      answer_type: "single_choice",
      status: "answered",
      selected_option_ids: ["opt_1"],
      blank_answers: [],
      confidence: 1,
      warnings: [],
    };
    const plan = buildAnswerExecutionPlan(question, answer, locatorMap, "unattended");
    const before = await adapter.readState(abortSignal());
    const actions = await adapter.execute(plan, locatorMap, abortSignal());
    const after = await adapter.readState(abortSignal());
    expect(after.selected_target_ids).toContain("opt_1");
    expect(new WebVerifier().verify(before, plan, actions, after).status).toBe("verified");
  });

  it("advances a graded H5P question whose choices disappear before its Next link is clicked", async () => {
    document.body.innerHTML = `<section class="h5p-question question">
      <h2>Choose a word</h2>
      <ul role="radiogroup"><li role="radio">This</li><li role="radio">These</li></ul>
      <button type="button">Check</button>
      <div class="h5p-question-feedback"></div>
      <a class="h5p-question-next" href="#" aria-label="Next">Next</a>
    </section>`;
    const adapter = new DomWebAdapter(document);
    const observation = await adapter.observeSession("h5p-graded", abortSignal());
    const { question, locator_map: locatorMap } = observation.questions[0]!;
    expect(locatorMap.targets).toHaveProperty("control_next");
    const before = await adapter.readState(abortSignal());
    document.querySelector("ul")!.remove();
    const feedback = document.querySelector<HTMLElement>(".h5p-question-feedback")!;
    feedback.classList.add("h5p-question-visible");
    feedback.textContent = "Correct! You got 1 out of 1 points";
    const after = await adapter.readState(abortSignal());
    expect(after.fingerprint).toBe(before.fingerprint);
    expect(after).toMatchObject({ has_next: true, completed: false });
    let advanced = false;
    document.querySelector("a.h5p-question-next")!.addEventListener("click", (event) => {
      event.preventDefault();
      advanced = true;
    });
    const result = await adapter.execute({
      schema_version: SCHEMA_VERSION,
      session_id: "h5p-graded",
      question_id: question.question_id,
      observation_id: observation.observation_id,
      strategy: "unattended",
      actions: [{ action_id: "next", kind: "advance", target_id: "control_next" }],
      preconditions: ["same_surface", "same_question_fingerprint", "target_available"],
    }, locatorMap, abortSignal());
    expect(result).toMatchObject([{ status: "succeeded" }]);
    expect(advanced).toBe(true);
  });

  it("maps H5P Check and final Finish as separate submission controls", async () => {
    document.body.innerHTML = `<section class="h5p-question question">
      <h2>Final word</h2><ul role="radiogroup"><li role="radio">This</li><li role="radio">That</li></ul>
      <button class="h5p-question-check-answer" aria-label="Check the answers. The responses will be marked.">Check</button>
      <button class="h5p-question-finish">Finish</button>
      <div class="h5p-question-scorebar"></div>
    </section>`;
    const adapter = new DomWebAdapter(document);
    const observation = await adapter.observeSession("h5p-last", abortSignal());
    const { question, locator_map: locatorMap } = observation.questions[0]!;
    expect(locatorMap.targets).toHaveProperty("control_submit");
    expect(locatorMap.targets).toHaveProperty("control_submit_session");
    const before = await adapter.readState(abortSignal());
    document.querySelector("ul")!.remove();
    const score = document.querySelector<HTMLElement>(".h5p-question-scorebar")!;
    score.classList.add("h5p-question-visible");
    score.textContent = "You got 1 out of 1 points";
    const after = await adapter.readState(abortSignal());
    expect(after.fingerprint).toBe(before.fingerprint);
    expect(after).toMatchObject({ has_session_submit: true, completed: false });
    let finished = false;
    document.querySelector(".h5p-question-finish")!.addEventListener("click", () => { finished = true; });
    const result = await adapter.execute({
      schema_version: SCHEMA_VERSION,
      session_id: "h5p-last",
      question_id: question.question_id,
      observation_id: observation.observation_id,
      strategy: "unattended",
      actions: [{ action_id: "finish", kind: "submit_session", target_id: "control_submit_session" }],
      preconditions: ["same_surface", "same_question_fingerprint", "target_available"],
    }, locatorMap, abortSignal());
    expect(result).toMatchObject([{ status: "succeeded" }]);
    expect(finished).toBe(true);
  });

  it("parses and executes a native single-choice question", async () => {
    document.body.innerHTML = `
      <form class="question">
        <h2>2 + 2 = ?</h2>
        <label><input type="radio" name="answer" value="3"> Three</label>
        <label><input type="radio" name="answer" value="4"> Four</label>
        <button type="button">Submit</button>
      </form>`;
    const adapter = new DomWebAdapter(document);
    const observation = await adapter.observeSession("s1", abortSignal());
    const { question, locator_map: locatorMap } = observation.questions[0]!;
    expect(question).toMatchObject({ type: "single_choice", stem: { text: "2 + 2 = ?" } });
    expect(question.options.map((option) => option.text)).toEqual(["Three", "Four"]);

    const answer: AnswerResult = {
      schema_version: SCHEMA_VERSION,
      session_id: "s1",
      question_id: question.question_id,
      observation_id: observation.observation_id,
      answer_type: "single_choice",
      status: "answered",
      selected_option_ids: ["opt_2"],
      blank_answers: [],
      confidence: 1,
      warnings: [],
    };
    const plan = buildAnswerExecutionPlan(question, answer, locatorMap, "unattended");
    const before = await adapter.readState(abortSignal());
    const actions = await adapter.execute(plan, locatorMap, abortSignal());
    const after = await adapter.readState(abortSignal());

    expect((document.querySelector("input[value='4']") as HTMLInputElement).checked).toBe(true);
    expect(new WebVerifier().verify(before, plan, actions, after)).toMatchObject({
      status: "verified",
      stage: "answer_applied",
    });
  });

  it("parses and fills multiple blanks", async () => {
    document.body.innerHTML = `
      <fieldset>
        <legend>Complete the pair</legend>
        <label>First <input type="text" required></label>
        <label>Second <input type="text" required></label>
      </fieldset>`;
    const adapter = new DomWebAdapter(document);
    const observation = await adapter.observeSession("s1", abortSignal());
    const { question, locator_map: locatorMap } = observation.questions[0]!;
    expect(question.type).toBe("fill_blank");
    expect(question.blanks).toHaveLength(2);

    const answer: AnswerResult = {
      schema_version: SCHEMA_VERSION,
      session_id: "s1",
      question_id: question.question_id,
      observation_id: observation.observation_id,
      answer_type: "fill_blank",
      status: "answered",
      selected_option_ids: [],
      blank_answers: [
        { blank_id: "blank_1", value: "A" },
        { blank_id: "blank_2", value: "B" },
      ],
      confidence: 0.9,
      warnings: [],
    };
    const plan = buildAnswerExecutionPlan(question, answer, locatorMap, "supervised");
    await adapter.execute(plan, locatorMap, abortSignal());
    expect(Array.from(document.querySelectorAll<HTMLInputElement>("input")).map((input) => input.value)).toEqual(["A", "B"]);
    const after = await adapter.readState(abortSignal());
    expect(after.field_values).toMatchObject({ blank_1: "A", blank_2: "B" });
  });

  it("keeps visible sentence context around fill-in-the-blank inputs", async () => {
    document.body.innerHTML = `<section class="question">
      <h2>Fill in the missing words</h2>
      <p>Is <input type="text" aria-label="Blank input 1 of 2"> coffee?</p>
      <p>No, <input type="text" aria-label="Blank input 2 of 2"> is tea.</p>
      <span hidden>Hidden solution text</span><button>Check</button>
    </section>`;
    const observation = await new DomWebAdapter(document).observeSession("blanks", abortSignal());
    const stem = observation.questions[0]!.question.stem.text;
    expect(stem).toContain("Is [blank_1] coffee?");
    expect(stem).toContain("No, [blank_2] is tea.");
    expect(stem).not.toContain("Hidden solution text");
  });

  it("prefers a quiz form over a navigation search field", async () => {
    document.body.innerHTML = `
      <header><form class="question"><label>Search field <input type="text"></label></form></header>
      <main>
        <h3>Question 1 of 40:</h3>
        <p id="qtext">What does HTML stand for?</p>
        <form role="form">
          <label>Hyper Text Markup Language<input type="radio" name="quiz" value="3"></label>
          <label>Hyperlinks and Text Markup Language<input type="radio" name="quiz" value="2"></label>
          <label>Home Tool Markup Language<input type="radio" name="quiz" value="1"></label>
          <button type="submit">Next ❯</button>
        </form>
      </main>`;

    const observation = await new DomWebAdapter(document).observeSession("w3", abortSignal());
    const parsed = observation.questions[0]!;

    expect(parsed.question).toMatchObject({
      type: "single_choice",
      stem: { text: "What does HTML stand for?" },
    });
    expect(parsed.question.options.map((option) => option.text)).toEqual([
      "Hyper Text Markup Language",
      "Hyperlinks and Text Markup Language",
      "Home Tool Markup Language",
    ]);
    expect(parsed.locator_map.targets).not.toHaveProperty("control_submit");
    expect(parsed.locator_map.targets).toHaveProperty("control_next");
    expect(observation.question_total).toBe(40);
  });

  it("ignores unrelated page spinners when the question itself is ready", async () => {
    document.body.innerHTML = `
      <aside><div class="spinner">Loading advertisement</div></aside>
      <fieldset>
        <legend>Ready question</legend>
        <label><input type="radio" name="ready"> Yes</label>
        <label><input type="radio" name="ready"> No</label>
      </fieldset>`;
    const adapter = new DomWebAdapter(document);

    await expect(adapter.waitUntilReady(abortSignal())).resolves.toEqual({ ready: true });
  });

  it("reads a nearby heading and text from custom radio-button quizzes", async () => {
    document.body.innerHTML = `
      <section class="quiz-engine">
        <div>
          <h2>Promise ordering</h2>
          <p>What is logged first?</p>
          <pre>Promise.resolve().then(() =&gt; console.log("microtask"));</pre>
        </div>
        <div role="radiogroup" aria-label="Answer choices">
          <button type="button" role="radio" aria-checked="false"><span>A</span><span>microtask</span></button>
          <button type="button" role="radio" aria-checked="false"><span>B</span><span>timer</span></button>
        </div>
      </section>`;

    const observation = await new DomWebAdapter(document).observeSession("s1", abortSignal());

    expect(observation.questions[0]?.question.stem.text).toContain("Promise ordering");
    expect(observation.questions[0]?.question.stem.text).toContain("What is logged first?");
    expect(observation.questions[0]?.question.options.map((option) => option.text)).toEqual([
      "A microtask",
      "B timer",
    ]);
  });

  it("prefers the actual heading over a question progress paragraph", async () => {
    document.body.innerHTML = `
      <form>
        <p>Question 3 of 10</p>
        <h2>Which iPad introduced the USB-C connector?</h2>
        <label><input type="radio" name="ipad"> iPad Pro</label>
        <label><input type="radio" name="ipad"> iPad mini</label>
      </form>`;

    const observation = await new DomWebAdapter(document).observeSession("s1", abortSignal());
    expect(observation.questions[0]?.question.stem.text).toBe("Which iPad introduced the USB-C connector?");
  });

  it("ignores pre-rendered disabled quiz cards and observes only the active question", async () => {
    document.body.innerHTML = `
      <form class="question"><h2>Inactive question</h2>
        <label><input type="radio" name="inactive" disabled> Old A</label>
        <label><input type="radio" name="inactive" disabled> Old B</label>
      </form>
      <form class="question"><h2>Active question</h2>
        <label><input type="radio" name="active"> Live A</label>
        <label><input type="radio" name="active"> Live B</label>
      </form>`;

    const observation = await new DomWebAdapter(document).observeSession("s1", abortSignal());
    expect(observation.questions[0]?.question.stem.text).toBe("Active question");
    expect(observation.questions[0]?.question.options.map((option) => option.text)).toEqual(["Live A", "Live B"]);
  });

  it("skips a progress-only legend in favor of a nested question prompt", async () => {
    document.body.innerHTML = `
      <fieldset class="question">
        <legend class="sr-only">Question 1 of 10</legend>
        <div><span>01</span><p>In which year did Apple introduce the first iPad?</p></div>
        <label><input type="radio" name="ipad"> 2010</label>
        <label><input type="radio" name="ipad"> 2012</label>
        <button type="button">Next →</button>
      </fieldset>`;

    const observation = await new DomWebAdapter(document).observeSession("s1", abortSignal());
    expect(observation.questions[0]?.question.stem.text).toBe("In which year did Apple introduce the first iPad?");
    expect(observation.questions[0]?.locator_map.targets).toHaveProperty("control_next");
  });

  it("recognizes W3Schools-style Next arrows and preserves C code option text", async () => {
    document.body.innerHTML = `
      <main>
        <h3>Question 3 of 40:</h3>
        <p>Which statement shifts x to the left?</p>
        <form class="question">
          <input type="text" name="site-search" value="C tutorial">
          <label><input type="radio" name="answer" value="a"><code>x &lt;&lt; 1;</code></label>
          <label><input type="radio" name="answer" value="b"><code>printf(&quot;%d&quot;, x);</code></label>
          <button type="button">Next ❯</button>
        </form>
      </main>`;

    const adapter = new DomWebAdapter(document);
    const observation = await adapter.observeSession("c-quiz", abortSignal());
    expect(observation.questions[0]?.question.options.map((option) => option.text)).toEqual([
      "x << 1;",
      'printf("%d", x);',
    ]);
    expect(observation.questions[0]?.locator_map.targets).toHaveProperty("control_next");
    await adapter.execute({
      schema_version: SCHEMA_VERSION,
      session_id: "c-quiz",
      question_id: observation.questions[0]!.question.question_id,
      observation_id: observation.observation_id,
      strategy: "unattended",
      actions: [{ action_id: "choose", kind: "set_selected", target_id: "opt_1", value: true }],
      preconditions: ["same_surface", "same_question_fingerprint", "target_available"],
    }, observation.questions[0]!.locator_map, abortSignal());
    expect(document.querySelector<HTMLInputElement>('input[value="a"]')?.checked).toBe(true);
    await expect(new DomWebAdapter(document).execute({
      schema_version: SCHEMA_VERSION,
      session_id: "c-quiz",
      question_id: observation.questions[0]!.question.question_id,
      observation_id: observation.observation_id,
      strategy: "unattended",
      actions: [{ action_id: "advance", kind: "advance", target_id: "control_next" }],
      preconditions: ["same_surface", "same_question_fingerprint", "target_available"],
    }, observation.questions[0]!.locator_map, abortSignal())).rejects.toThrow(/PAGE_CHANGED.*reason=observation_missing/);
    document.querySelector("main > p")!.textContent = "How do you insert a comment in C?";
    await expect(new DomWebAdapter(document).execute({
      schema_version: SCHEMA_VERSION,
      session_id: "c-quiz",
      question_id: observation.questions[0]!.question.question_id,
      observation_id: observation.observation_id,
      strategy: "unattended",
      actions: [{ action_id: "advance", kind: "advance", target_id: "control_next" }],
      preconditions: ["same_surface", "same_question_fingerprint", "target_available"],
    }, observation.questions[0]!.locator_map, abortSignal())).resolves.toMatchObject([
      { action_id: "advance", status: "unknown" },
    ]);
  });

  it("captures a disabled page-level final submit and exposes it only when enabled", async () => {
    document.body.innerHTML = `
      <p>Question 2 of 2</p>
      <fieldset class="question">
        <legend>Last question</legend>
        <label><input type="radio" name="last" value="yes"> Yes</label>
        <label><input type="radio" name="last" value="no"> No</label>
      </fieldset>
      <footer><button id="finish" type="button" disabled>Submit test</button></footer>`;
    const adapter = new DomWebAdapter(document);
    const observation = await adapter.observeSession("s1", abortSignal());
    const locatorMap = observation.questions[0]!.locator_map;
    expect(locatorMap.targets).toHaveProperty("control_submit_session");
    await expect(adapter.readState(abortSignal())).resolves.toMatchObject({
      has_session_submit: false,
      at_last_question: true,
    });

    let clicked = false;
    const finish = document.querySelector<HTMLButtonElement>("#finish")!;
    finish.disabled = false;
    finish.addEventListener("click", () => { clicked = true; });
    await expect(adapter.readState(abortSignal())).resolves.toMatchObject({ has_session_submit: true });
    await adapter.execute({
      schema_version: SCHEMA_VERSION,
      session_id: "s1",
      question_id: observation.questions[0]!.question.question_id,
      observation_id: observation.observation_id,
      strategy: "unattended",
      actions: [{ action_id: "finish", kind: "submit_session", target_id: "control_submit_session" }],
      preconditions: ["same_surface", "same_question_fingerprint", "target_available"],
    }, locatorMap, abortSignal());
    expect(clicked).toBe(true);
  });

  it("recognizes a final quiz action as a submit control", async () => {
    document.body.innerHTML = `
      <fieldset class="question">
        <legend>Final question</legend>
        <label><input type="radio" name="final"> A</label>
        <label><input type="radio" name="final"> B</label>
        <button type="button">Finish quiz</button>
      </fieldset>`;

    const observation = await new DomWebAdapter(document).observeSession("s1", abortSignal());
    expect(observation.questions[0]?.locator_map.targets).toHaveProperty("control_submit");
  });

  it("treats a completed route as a completed quiz", async () => {
    window.history.replaceState({}, "", "/quiz/technology/ipad/completed");
    document.body.innerHTML = `
      <form><fieldset><legend>Final question</legend>
        <label><input type="radio" name="final"> A</label>
        <label><input type="radio" name="final"> B</label>
      </fieldset></form>`;
    const adapter = new DomWebAdapter(document);
    await adapter.observeSession("s1", abortSignal());
    await expect(adapter.readState(abortSignal())).resolves.toMatchObject({ completed: true });
    window.history.replaceState({}, "", "/");
  });

  it("rebinds answer and navigation targets after a framework replaces the question DOM", async () => {
    document.body.innerHTML = `
      <section class="question">
        <h2>Framework-rendered question</h2>
        <div role="radiogroup">
          <button type="button" role="radio" aria-checked="false">A</button>
          <button type="button" role="radio" aria-checked="false">B</button>
        </div>
        <button type="button">Next</button>
      </section>`;
    const root = document.querySelector<HTMLElement>(".question")!;
    root.querySelectorAll<HTMLElement>("[role='radio']")[1]!.addEventListener("click", () => {
      root.innerHTML = `
        <h2>Framework-rendered question</h2>
        <div role="radiogroup">
          <button type="button" role="radio" aria-checked="false">A</button>
          <button type="button" role="radio" aria-checked="true">B</button>
        </div>
        <button type="button">Next</button>`;
    });
    const adapter = new DomWebAdapter(document);
    const observation = await adapter.observeSession("s1", abortSignal());
    const { question, locator_map: locatorMap } = observation.questions[0]!;
    const answer: AnswerResult = {
      schema_version: SCHEMA_VERSION,
      session_id: "s1",
      question_id: question.question_id,
      observation_id: observation.observation_id,
      answer_type: "single_choice",
      status: "answered",
      selected_option_ids: ["opt_2"],
      blank_answers: [],
      confidence: 1,
      warnings: [],
    };
    const answerPlan = buildAnswerExecutionPlan(question, answer, locatorMap, "unattended");

    await adapter.execute(answerPlan, locatorMap, abortSignal());
    await expect(adapter.readState(abortSignal())).resolves.toMatchObject({ selected_target_ids: ["opt_2"] });

    let advanced = false;
    root.querySelector<HTMLButtonElement>("button:not([role])")!.addEventListener("click", () => { advanced = true; });
    await adapter.execute({
      schema_version: SCHEMA_VERSION,
      session_id: "s1",
      question_id: question.question_id,
      observation_id: observation.observation_id,
      strategy: "unattended",
      actions: [{ action_id: "next", kind: "advance", target_id: "control_next" }],
      preconditions: ["same_surface", "same_question_fingerprint", "target_available"],
    }, locatorMap, abortSignal());
    expect(advanced).toBe(true);
  });

  it("does not rebind an option by position when its semantic identity changes", async () => {
    document.body.innerHTML = `
      <fieldset class="question"><legend>Stable question</legend>
        <label><input type="radio" name="answer" value="alpha"> Alpha</label>
        <label><input type="radio" name="answer" value="beta"> Beta</label>
      </fieldset>`;
    const adapter = new DomWebAdapter(document);
    const observation = await adapter.observeSession("s1", abortSignal());
    const { question, locator_map: locatorMap } = observation.questions[0]!;
    const answer: AnswerResult = {
      schema_version: SCHEMA_VERSION,
      session_id: "s1",
      question_id: question.question_id,
      observation_id: observation.observation_id,
      answer_type: "single_choice",
      status: "answered",
      selected_option_ids: ["opt_2"],
      blank_answers: [],
      confidence: 1,
      warnings: [],
    };
    const plan = buildAnswerExecutionPlan(question, answer, locatorMap, "unattended");
    document.querySelector("fieldset")!.innerHTML = `
      <legend>Stable question</legend>
      <label><input type="radio" name="answer" value="beta"> Alpha</label>
      <label><input type="radio" name="answer" value="alpha"> Beta</label>`;

    const actions = await adapter.execute(plan, locatorMap, abortSignal());
    expect(actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "failed", message: expect.stringContaining("semantic_match_failed") }),
    ]));
    expect(Array.from(document.querySelectorAll<HTMLInputElement>("input")).some((input) => input.checked)).toBe(false);
  });

  it("rejects a stale plan when the option order changes", async () => {
    document.body.innerHTML = `
      <fieldset><legend>Order-sensitive question</legend>
        <label><input type="radio" name="answer" value="a"> Alpha</label>
        <label><input type="radio" name="answer" value="b"> Beta</label>
      </fieldset>`;
    const adapter = new DomWebAdapter(document);
    const observation = await adapter.observeSession("s1", abortSignal());
    const { question, locator_map: locatorMap } = observation.questions[0]!;
    const answer: AnswerResult = {
      schema_version: SCHEMA_VERSION,
      session_id: "s1",
      question_id: question.question_id,
      observation_id: observation.observation_id,
      answer_type: "single_choice",
      status: "answered",
      selected_option_ids: ["opt_2"],
      blank_answers: [],
      confidence: 1,
      warnings: [],
    };
    const plan = buildAnswerExecutionPlan(question, answer, locatorMap, "unattended");
    const fieldset = document.querySelector("fieldset")!;
    const labels = fieldset.querySelectorAll("label");
    fieldset.insertBefore(labels[1]!, labels[0]!);

    await expect(adapter.execute(plan, locatorMap, abortSignal())).rejects.toThrow(/PAGE_CHANGED.*old_fingerprint=.*new_fingerprint=/);
  });

  it("refuses stale actions after the question changes", async () => {
    document.body.innerHTML = `
      <fieldset><legend>Old question</legend>
        <label><input type="radio" name="a"> A</label>
        <label><input type="radio" name="a"> B</label>
      </fieldset>`;
    const adapter = new DomWebAdapter(document);
    const observation = await adapter.observeSession("s1", abortSignal());
    const { question, locator_map: locatorMap } = observation.questions[0]!;
    const answer: AnswerResult = {
      schema_version: SCHEMA_VERSION,
      session_id: "s1",
      question_id: question.question_id,
      observation_id: observation.observation_id,
      answer_type: "single_choice",
      status: "answered",
      selected_option_ids: ["opt_1"],
      blank_answers: [],
      confidence: 1,
      warnings: [],
    };
    const plan = buildAnswerExecutionPlan(question, answer, locatorMap, "unattended");
    document.querySelector("legend")!.textContent = "New question";

    await expect(adapter.execute(plan, locatorMap, abortSignal())).rejects.toThrow("PAGE_CHANGED");
  });

  it("detects captcha and proctoring as hard blockers", () => {
    document.body.textContent = "Please verify you are human with CAPTCHA";
    expect(new DomWebAdapter(document).detectHardBlocker()).toBe("captcha");
    document.body.textContent = "This proctor monitors your screen";
    expect(new DomWebAdapter(document).detectHardBlocker()).toBe("proctoring");
  });

  it("builds a sanitized semantic page snapshot with temporary control ids", async () => {
    document.body.innerHTML = `
      <script>window.secret = "do not send"</script>
      <nav>Quiz navigation</nav>
      <fieldset><legend>Which value is valid?</legend>
        <label><input type="radio" name="answer" value="a"> Alpha</label>
        <label><input type="radio" name="answer" value="b"> Beta</label>
      </fieldset>
      <button>Continue to review</button>
      <input type="password" value="private-value">`;

    const observation = await new DomWebAdapter(document).observeSession("s1", abortSignal(), "semantic_snapshot");

    expect(observation.page_context).toMatchObject({
      mode: "semantic_snapshot",
      media: [],
    });
    expect(observation.page_context?.visible_text).toContain("Which value is valid?");
    expect(observation.page_context?.visible_text).not.toContain("do not send");
    expect(observation.page_context?.visible_text).not.toContain("private-value");
    expect(observation.page_context?.controls).toEqual(expect.arrayContaining([
      expect.objectContaining({ semantic_id: "opt_1", role: "option", text: "Alpha" }),
      expect.objectContaining({ semantic_id: expect.stringMatching(/^candidate_control_/), text: "Continue to review" }),
    ]));
  });

  it("keeps an unfamiliar button executable after snapshot and locally visible in structured mode", async () => {
    document.body.innerHTML = `
      <fieldset><legend>First question?</legend>
        <label><input type="radio" name="answer"> A</label>
        <label><input type="radio" name="answer"> B</label>
      </fieldset>
      <button type="button">Go to next question</button>`;
    const adapter = new DomWebAdapter(document);
    const first = await adapter.observeSession("s1", abortSignal(), "semantic_snapshot");
    const candidate = first.local_control_candidates?.find((control) => control.text === "Go to next question");
    expect(candidate?.semantic_id).toMatch(/^candidate_control_/);
    expect(first.page_context?.controls).toEqual(expect.arrayContaining([
      expect.objectContaining({ semantic_id: candidate?.semantic_id, text: "Go to next question" }),
    ]));
    const button = document.querySelector("button")!;
    button.addEventListener("click", () => { document.querySelector("legend")!.textContent = "Second question?"; });
    const result = await adapter.execute({
      schema_version: SCHEMA_VERSION,
      session_id: "s1",
      question_id: first.questions[0]!.question.question_id,
      observation_id: first.observation_id,
      strategy: "unattended",
      actions: [{ action_id: "advance", kind: "advance", target_id: candidate!.semantic_id }],
      preconditions: ["same_surface", "same_question_fingerprint", "target_available"],
    }, first.questions[0]!.locator_map, abortSignal());
    expect(result).toMatchObject([{ status: "succeeded" }]);
    expect(document.querySelector("legend")?.textContent).toBe("Second question?");
    const second = await adapter.observeSession("s1", abortSignal(), "structured");
    expect(second.page_context).toBeUndefined();
    expect(second.local_control_candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "Go to next question", disabled: false }),
    ]));
  });

  it("observes a question inside an open shadow root", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <fieldset>
        <legend>Shadow question</legend>
        <label><input type="radio" name="shadow"> Yes</label>
        <label><input type="radio" name="shadow"> No</label>
      </fieldset>`;

    const observation = await new DomWebAdapter(document).observeSession("s1", abortSignal());
    expect(observation.questions[0]?.question).toMatchObject({
      type: "single_choice",
      stem: { text: "Shadow question" },
    });
  });

  it("uses validated model region IDs to recover a missed stem and reuse the layout", async () => {
    document.body.innerHTML = `<main><section class="quiz-layout"><p>Which language is compiled?</p><div class="answers"><label><input type="radio" name="q" value="a"> C</label><label><input type="radio" name="q" value="b"> CSS</label></div></section></main>`;
    const adapter = new DomWebAdapter(document);
    const initial = await adapter.observeSession("s1", abortSignal(), "semantic_snapshot");
    expect(initial.questions[0]!.question.stem.text).not.toContain("Which language is compiled?");
    const candidate = adapter.captureSeparation();
    expect(candidate.suggested).toBe(true);
    const region = candidate.snapshot.candidates.find((item) => item.kind === "region")!;
    const optionIds = candidate.snapshot.candidates.filter((item) => item.kind === "option").map((item) => item.semantic_id);
    expect(adapter.applySeparation({ region_id: region.semantic_id, option_ids: [optionIds[1]!, optionIds[0]!] })).toBeNull();
    const structure = adapter.applySeparation({ region_id: region.semantic_id, option_ids: optionIds });
    expect(structure).not.toBeNull();
    const calibrated = await adapter.observeSession("s1", abortSignal(), "semantic_snapshot");
    expect(calibrated.questions[0]!.question.stem.text).toBe("Which language is compiled?");
    expect(calibrated.questions[0]!.question.options.map((option) => option.text)).toEqual(["C", "CSS"]);

    document.body.innerHTML = `<main><section class="quiz-layout"><p>Which language is interpreted?</p><div class="answers"><label><input type="radio" name="q" value="x"> JavaScript</label><label><input type="radio" name="q" value="y"> C</label></div></section></main>`;
    const nextAdapter = new DomWebAdapter(document);
    expect(nextAdapter.reuseSeparation(structure!)).toBe(true);
    const next = await nextAdapter.observeSession("s1", abortSignal(), "structured");
    expect(next.page_context).toBeUndefined();
    expect(next.questions[0]!.question.stem.text).toBe("Which language is interpreted?");
  });
});
