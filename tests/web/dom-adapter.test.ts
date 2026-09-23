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
