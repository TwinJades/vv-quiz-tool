import {
  SCHEMA_VERSION,
  type ActionResult,
  type ExecutionPlan,
  type LocatorMap,
  type MediaRef,
  type ObservationInputMode,
  type PlatformAdapter,
  type PlatformCapabilities,
  type PlatformObservation,
  type PlatformState,
  type QuestionFrame,
  type ReadinessResult,
} from "../core";
import { dispatchValueEvents, elementText, fnv1a, isExplicitlyHidden, labelText, normalizedText } from "./dom-utils";
import { SeparationTrial } from "./separation-trial";
import type { LocalStructure, SeparationRoles, SeparationSnapshot } from "./separation-trial";

interface TargetIdentity {
  role: "option" | "blank" | "submit" | "session_submit" | "next" | "retry" | "candidate";
  question_fingerprint: string;
  input_name: string;
  input_value: string;
  text_digest: string;
}

type DomTarget =
  | { kind: "element"; element: HTMLElement; identity: TargetIdentity }
  | { kind: "select_option"; element: HTMLSelectElement; value: string; identity: TargetIdentity };

interface TargetResolution {
  target?: DomTarget;
  reason?: "node_detached" | "semantic_match_failed" | "semantic_match_ambiguous" | "question_changed";
  current_fingerprint: string;
}

interface MediaSource {
  source_url: string;
  mime_type: string;
}

const QUESTION_ROOT_SELECTORS = [
  "[data-vv-question]",
  "[data-question]",
  ".quiz-question",
  ".question",
  "fieldset",
  "form",
  "[role='radiogroup']",
  "[role='group']",
];

const SUPPORTED_CONTROL_SELECTOR = [
  "input[type='radio']",
  "input[type='checkbox']",
  "input[type='text']",
  "input[type='number']",
  "input:not([type])",
  "textarea",
  "select:not([multiple])",
  "[contenteditable='true']",
  "[role='radio']",
  "[role='checkbox']",
].join(",");

const SUBMIT_PATTERN = /^(?:submit(?:\s+\d+\s+answers?)?|finish(?:\s+quiz)?|check|confirm|提交|确认|交卷|检查答案|完成)$/i;
const SESSION_SUBMIT_PATTERN = /^(?:submit(?:\s+(?:(?:the\s+)?(?:test|quiz|interview)|\d+\s+answers?|answers?))|finish(?:\s+(?:(?:the\s+)?(?:test|quiz|interview)))|提交试卷|完成测试|结束测验)$/i;
const NEXT_PATTERN = /^(next|continue|下一题|继续|下一步)\s*(?:→|›|»|❯|>)?$/i;
const RETRY_PATTERN = /^(retry|try again|重试|再试一次|重新作答)$/i;

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function supportedInput(element: Element): boolean {
  if (element.getAttribute("aria-disabled") === "true") return false;
  if ("disabled" in element && (element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement).disabled) {
    return false;
  }
  if (!(element instanceof HTMLInputElement)) return true;
  return !["password", "file", "hidden", "submit", "button", "reset"].includes(element.type);
}

function optionLabel(document: Document, control: HTMLElement): string {
  const labelElement = control.closest("label") ??
    (control.id ? document.querySelector<HTMLElement>(`label[for='${CSS.escape(control.id)}']`) : null) ??
    control;
  const clone = labelElement.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("input, textarea, select, button").forEach((element) => element.remove());
  const spacedText = Array.from(clone.childNodes)
    .map((node) => normalizedText(node.textContent?.replace(/\u00a0/g, " ")))
    .filter(Boolean)
    .join(" ");
  return labelText(document, control) && control.getAttribute("aria-label")
    ? labelText(document, control)
    : spacedText || labelText(document, control);
}

function collectContexts(document: Document): ParentNode[] {
  const contexts: ParentNode[] = [document];
  const queue: ParentNode[] = [document];
  let visitedElements = 0;
  while (queue.length > 0 && visitedElements < 10_000 && contexts.length < 64) {
    const context = queue.shift()!;
    for (const element of Array.from(context.querySelectorAll<HTMLElement>("*"))) {
      visitedElements += 1;
      if (element.shadowRoot) {
        contexts.push(element.shadowRoot);
        queue.push(element.shadowRoot);
      }
      if (element instanceof HTMLIFrameElement) {
        try {
          if (element.contentDocument) {
            contexts.push(element.contentDocument);
            queue.push(element.contentDocument);
          }
        } catch {
          // Cross-origin frames are handled through permission pause/reinjection.
        }
      }
      if (visitedElements >= 10_000) break;
    }
  }
  return contexts;
}

function queryAllDeep<T extends Element>(document: Document, selector: string): T[] {
  return collectContexts(document).flatMap((context) => Array.from(context.querySelectorAll<T>(selector)));
}

function candidateRoots(document: Document): HTMLElement[] {
  const explicit = queryAllDeep<HTMLElement>(document, QUESTION_ROOT_SELECTORS.join(","))
    .filter((element) => !isExplicitlyHidden(element))
    .filter((element) => Array.from(element.querySelectorAll(SUPPORTED_CONTROL_SELECTOR)).some(supportedInput));
  if (explicit.length > 0) {
    const leaves = explicit.filter((candidate) => !explicit.some((other) => other !== candidate && candidate.contains(other)));
    const candidates = leaves.length > 0 ? leaves : explicit;
    const scored = candidates
      .map((element) => ({ element, score: questionRootScore(element) }))
      .sort((left, right) => right.score - left.score);
    const bestScore = scored[0]?.score ?? 0;
    return scored
      .filter(({ score }) => score > 0 && score >= Math.min(bestScore, 20))
      .map(({ element }) => element);
  }

  const firstControl = queryAllDeep<HTMLElement>(document, SUPPORTED_CONTROL_SELECTOR)
    .find((element) => !isExplicitlyHidden(element) && supportedInput(element));
  if (!firstControl) return [];
  return [firstControl.closest<HTMLElement>("form") ?? firstControl.parentElement ?? document.body];
}

function questionRootScore(root: HTMLElement): number {
  if (root.closest("header, nav, aside, [role='search']")) return -1_000;
  const choiceControls = root.querySelectorAll(
    "input[type='radio'], input[type='checkbox'], [role='radio'], [role='checkbox']",
  ).length;
  const selects = root.querySelectorAll("select:not([multiple])").length;
  const textControls = root.querySelectorAll(
    "input[type='text'], input[type='number'], input:not([type]), textarea, [contenteditable='true']",
  ).length;
  const questionMarker = root.matches("[data-vv-question], [data-question], .quiz-question, .question, fieldset") ? 30 : 0;
  const submitControl = root.querySelector("button[type='submit'], input[type='submit']") ? 10 : 0;
  const nearbyText = [root.previousElementSibling, root.previousElementSibling?.previousElementSibling, root.parentElement]
    .map((element) => elementText(element ?? null))
    .join(" ")
    .slice(0, 2_000);
  const progressMarker = /(?:question|题目)\s*\d+\s*(?:of|\/|共)\s*\d+/i.test(nearbyText) ? 250 : 0;
  return choiceControls * 100 + selects * 80 + textControls * 20 + questionMarker + submitControl + progressMarker;
}

function elementInputName(element: HTMLElement): string {
  return element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement
    ? normalizedText(element.name)
    : normalizedText(element.getAttribute("name"));
}

function elementInputValue(element: HTMLElement): string {
  const value = element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement
    ? normalizedText(element.value)
    : normalizedText(element.getAttribute("value"));
  return value === "on" ? "" : value;
}

function targetText(document: Document, element: HTMLElement): string {
  if (element.matches("input[type='radio'], input[type='checkbox'], [role='radio'], [role='checkbox']")) {
    return optionLabel(document, element);
  }
  if (element.matches("input[type='text'], input[type='number'], input:not([type]), textarea, [contenteditable='true']")) {
    return labelText(document, element) || normalizedText(element.getAttribute("placeholder") || element.getAttribute("name"));
  }
  return normalizedText(element instanceof HTMLInputElement ? element.value : element.getAttribute("aria-label") || element.textContent);
}

function targetIdentity(
  document: Document,
  element: HTMLElement,
  role: TargetIdentity["role"],
  questionFingerprint = "pending",
): TargetIdentity {
  return {
    role,
    question_fingerprint: questionFingerprint,
    input_name: elementInputName(element),
    input_value: role === "blank" ? "" : elementInputValue(element),
    text_digest: fnv1a(targetText(document, element)),
  };
}

function questionStem(document: Document, root: HTMLElement): string {
  const labelledBy = root.getAttribute("aria-labelledby");
  if (labelledBy) {
    const labelled = labelledBy
      .split(/\s+/)
      .map((id) => elementText(document.getElementById(id)))
      .filter(Boolean)
      .join(" ");
    if (labelled) return labelled;
  }

  const progressOnly = (text: string) => /^(?:question|题目)\s*\d+\s*(?:of|\/|共)\s*\d+\s*[:：]?$/i.test(text);
  const semantic = root.querySelector<HTMLElement>("[data-question-stem], .question-text, .stem");
  const semanticText = elementText(semantic);
  if (semanticText && !progressOnly(semanticText)) return semanticText;

  const heading = root.querySelector<HTMLElement>(":scope > h1, :scope > h2, :scope > h3");
  const headingText = elementText(heading);
  if (headingText && !progressOnly(headingText)) return headingText;

  const legend = root.querySelector<HTMLElement>(":scope > legend");
  const legendText = elementText(legend);
  if (legendText && !progressOnly(legendText)) return legendText;

  const nestedQuestionText = Array.from(root.querySelectorAll<HTMLElement>("h1, h2, h3, p"))
    .filter((element) => !element.closest("button, label"))
    .map(elementText)
    .filter((text) => text && !progressOnly(text) && !/^press\s+.+to answer/i.test(text))
    .sort((left, right) => Number(right.includes("?")) - Number(left.includes("?")) || right.length - left.length)[0];
  if (nestedQuestionText) return nestedQuestionText;

  const paragraphText = Array.from(root.querySelectorAll<HTMLElement>(":scope > p"))
    .map(elementText)
    .find((text) => text && !progressOnly(text));
  if (paragraphText) return paragraphText;

  if (root instanceof HTMLFormElement) {
    let sibling = root.previousElementSibling;
    for (let checked = 0; sibling && checked < 3; checked += 1, sibling = sibling.previousElementSibling) {
      if (sibling.matches("[data-question-stem], .question-text, .stem, h1, h2, h3, h4, h5, h6, p")) {
        const siblingText = elementText(sibling);
        if (siblingText && !/^(?:question|题目)\s*\d+\s*(?:of|\/|共)/i.test(siblingText)) return siblingText;
      }
    }
  }

  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("input, textarea, select, button, script, style, [role='radio'], [role='checkbox']")
    .forEach((element) => element.remove());
  const fallback = elementText(clone).slice(0, 4_000);
  if (fallback) return fallback;

  let ancestor = root.parentElement;
  for (let depth = 0; ancestor && depth < 3; depth += 1, ancestor = ancestor.parentElement) {
    const heading = Array.from(ancestor.querySelectorAll<HTMLElement>("h1, h2, h3, [data-question-stem], .question-text, .stem"))
      .filter((element) => !root.contains(element))
      .find((element) => elementText(element));
    if (!heading) continue;
    const context = heading.parentElement ?? ancestor;
    const parts = [heading, ...Array.from(context.querySelectorAll<HTMLElement>("p, pre"))]
      .filter((element) => !root.contains(element))
      .map(elementText)
      .filter(Boolean);
    return [...new Set(parts)].join("\n").slice(0, 4_000);
  }
  return "";
}

function semanticStem(document: Document, root: HTMLElement): { text: string; hasMath: boolean } {
  const base = questionStem(document, root);
  const mathSources = Array.from(
    root.querySelectorAll<HTMLElement>("annotation[encoding='application/x-tex'], [data-tex]"),
  )
    .map((element) => normalizedText(element.getAttribute("data-tex") || element.textContent))
    .filter(Boolean);
  return {
    text: mathSources.length > 0 ? `${base}\nMath: ${mathSources.join("; ")}` : base,
    hasMath: mathSources.length > 0,
  };
}

function imageMedia(
  image: HTMLImageElement,
  mediaSources: Map<string, MediaSource>,
  purpose: string,
): MediaRef | null {
  const source = image.currentSrc || image.src;
  if (!source) return null;
  const handle = randomId("media");
  const mimeType = source.startsWith("data:image/")
    ? source.slice(5, source.indexOf(";"))
    : "image/*";
  mediaSources.set(handle, { source_url: source, mime_type: mimeType });
  return {
    id: randomId("image"),
    kind: "image",
    purpose,
    source: "dom_image",
    mime_type: mimeType,
    width: image.naturalWidth || image.width || 1,
    height: image.naturalHeight || image.height || 1,
    temporary_handle: handle,
  };
}

export class DomWebAdapter implements PlatformAdapter {
  readonly #document: Document;
  #targets = new Map<string, DomTarget>();
  #mediaSources = new Map<string, MediaSource>();
  #currentObservation: PlatformObservation | undefined;
  #currentLocator: LocatorMap | undefined;
  #separationTrial: SeparationTrial;
  #calibratedRoot: HTMLElement | null = null;

  constructor(document: Document) {
    this.#document = document;
    this.#separationTrial = new SeparationTrial(document);
  }

  captureSeparation(): { snapshot: SeparationSnapshot; suggested: boolean } {
    const snapshot = this.#separationTrial.capture();
    const currentStem = this.#currentObservation?.questions[0]?.question.stem.text ?? "";
    const suggested = this.#separationTrial.candidateStems().some((stem) =>
      stem.length >= 8 && /[?？]|question|题/i.test(stem) && !currentStem.includes(stem),
    );
    return { snapshot, suggested };
  }

  applySeparation(roles: SeparationRoles): LocalStructure | null {
    const separated = this.#separationTrial.separate(roles);
    if (!separated || !this.#separationTrial.remember(roles)) return null;
    this.#calibratedRoot = this.#separationTrial.validate(roles);
    return this.#separationTrial.structure();
  }

  reuseSeparation(structure: LocalStructure): boolean {
    this.#separationTrial = new SeparationTrial(this.#document, structure);
    this.#calibratedRoot = this.#separationTrial.reuse();
    if (!this.#calibratedRoot) this.#separationTrial = new SeparationTrial(this.#document);
    return this.#calibratedRoot !== null;
  }

  #activeRoot(): HTMLElement | undefined {
    if (this.#calibratedRoot?.isConnected && !isExplicitlyHidden(this.#calibratedRoot)) return this.#calibratedRoot;
    if (this.#separationTrial.structure()) {
      this.#calibratedRoot = this.#separationTrial.reuse();
      if (this.#calibratedRoot) return this.#calibratedRoot;
      return undefined;
    }
    return candidateRoots(this.#document)[0];
  }

  capabilities(): PlatformCapabilities {
    return {
      question_types: ["single_choice", "multiple_choice", "fill_blank"],
      multi_question_page: false,
      text_input: true,
      image_input: true,
      semantic_targeting: true,
      coordinate_targeting: false,
      submit: true,
      advance: true,
      grading_feedback: true,
      timer_observation: true,
    };
  }

  async waitUntilReady(signal: AbortSignal): Promise<ReadinessResult> {
    const deadline = Date.now() + 10_000;
    let lastFingerprint = "";
    let stableSince = 0;
    while (Date.now() < deadline) {
      if (signal.aborted) return { ready: false, reason: "cancelled" };
      const blocker = this.detectHardBlocker();
      if (blocker) return { ready: false, reason: blocker };
      const roots = this.#calibratedRoot?.isConnected ? [this.#calibratedRoot] : candidateRoots(this.#document);
      const activeRoot = roots[0];
      if (activeRoot && Array.from(activeRoot.querySelectorAll("textarea, [contenteditable='true']"))
        .some((element) => !isExplicitlyHidden(element) && supportedInput(element))) {
        return { ready: false, reason: "unsupported_subjective_question" };
      }
      const busy = activeRoot?.matches("[aria-busy='true'], .loading, .spinner") ||
        activeRoot?.querySelector("[aria-busy='true'], .loading, .spinner");
      if (this.#document.readyState !== "loading" && roots.length > 0 && !busy) {
        const root = activeRoot!;
        const fingerprint = fnv1a(
          `${semanticStem(root.ownerDocument, root).text}|${root.querySelectorAll(SUPPORTED_CONTROL_SELECTOR).length}|${elementText(root).slice(0, 4_000)}`,
        );
        if (fingerprint !== lastFingerprint) {
          lastFingerprint = fingerprint;
          stableSince = Date.now();
        } else if (Date.now() - stableSince >= 500) {
          return { ready: true };
        }
      } else {
        lastFingerprint = "";
        stableSince = 0;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    return { ready: false, reason: "readiness_timeout" };
  }

  async observeSession(
    sessionId: string,
    signal: AbortSignal,
    mode: ObservationInputMode = "structured",
  ): Promise<PlatformObservation> {
    if (signal.aborted) throw new DOMException("Observation cancelled.", "AbortError");
    const blocker = this.detectHardBlocker();
    if (blocker) throw new Error(`HARD_BLOCKER:${blocker}`);
    const activeRoot = this.#activeRoot();
    const roots = this.#separationTrial.structure() ? (activeRoot ? [activeRoot] : []) : candidateRoots(this.#document);
    if (roots.length === 0) throw new Error("No supported question was found.");
    const root = roots[0]!;
    if (Array.from(root.querySelectorAll("textarea, [contenteditable='true']"))
      .some((element) => !isExplicitlyHidden(element) && supportedInput(element))) {
      throw new Error("HARD_BLOCKER:unsupported_subjective_question");
    }
    const radioNames = new Set(
      Array.from(root.querySelectorAll<HTMLInputElement>("input[type='radio'][name]"))
        .map((input) => input.name)
        .filter(Boolean),
    );
    const multiQuestionPage = roots.length > 1 || radioNames.size > 1;
    const observationId = randomId("observation");
    this.#targets = new Map();
    this.#mediaSources = new Map();
    const parsed = this.#parseQuestion(root, sessionId, observationId);
    const localControlCandidates = this.#registerCandidateControls(parsed.locator_map);
    const pageContext = mode === "structured" ? undefined : this.#buildPageContext(root, mode);
    const observation: PlatformObservation = {
      session_id: sessionId,
      observation_id: observationId,
      captured_at: new Date().toISOString(),
      surface_id: this.#document.location?.href ?? "document",
      surface_origin: this.#document.location?.origin ?? "null",
      surface_title: this.#document.title,
      layout: multiQuestionPage ? "multi_question_page" : "sequential",
      questions: [parsed],
      question_total: this.#readQuestionTotal(),
      timer_remaining_seconds: this.#readTimer(),
      fingerprint: parsed.locator_map.question_fingerprint,
      stable_for_ms: 500,
      local_control_candidates: localControlCandidates,
      ...(pageContext ? { page_context: pageContext } : {}),
    };
    this.#currentObservation = observation;
    this.#currentLocator = parsed.locator_map;
    return observation;
  }

  async execute(plan: ExecutionPlan, locatorMap: LocatorMap, signal: AbortSignal): Promise<ActionResult[]> {
    if (signal.aborted) throw new DOMException("Execution cancelled.", "AbortError");
    if (!this.#currentObservation || !this.#currentLocator) {
      const currentFingerprint = this.#fingerprintCurrentQuestion();
      if (
        currentFingerprint !== locatorMap.question_fingerprint &&
        plan.actions.every((action) => ["advance", "submit_question", "submit_session"].includes(action.kind))
      ) {
        return plan.actions.map((action) => ({
          action_id: action.action_id,
          status: "unknown" as const,
          message: "The destination question was already present before the control response; verify the changed fingerprint.",
        }));
      }
      throw new Error(
        `PAGE_CHANGED stage=ACT page_changed=${currentFingerprint !== locatorMap.question_fingerprint} old_fingerprint=${locatorMap.question_fingerprint} new_fingerprint=${currentFingerprint} target=none reason=observation_missing`,
      );
    }
    if (
      plan.observation_id !== this.#currentObservation.observation_id ||
      locatorMap.observation_id !== this.#currentObservation.observation_id
    ) {
      throw new Error(
        `PAGE_CHANGED stage=ACT page_changed=true old_fingerprint=${locatorMap.question_fingerprint} new_fingerprint=observation_changed target=none reason=observation_changed`,
      );
    }
    const currentFingerprint = this.#fingerprintCurrentQuestion();
    if (locatorMap.question_fingerprint !== currentFingerprint) {
      throw new Error(
        `PAGE_CHANGED stage=ACT page_changed=true old_fingerprint=${locatorMap.question_fingerprint} new_fingerprint=${currentFingerprint} target=none reason=question_changed`,
      );
    }

    const results: ActionResult[] = [];
    for (const action of plan.actions) {
      const storedTarget = this.#targets.get(action.target_id);
      const resolution = storedTarget
        ? this.#resolveLiveTarget(action.target_id, storedTarget)
        : { reason: "semantic_match_failed" as const, current_fingerprint: currentFingerprint };
      const target = resolution.target;
      if (!target) {
        results.push({
          action_id: action.action_id,
          status: "failed",
          message: `TARGET_UNAVAILABLE target=${action.target_id} reason=${resolution.reason ?? "semantic_match_failed"} old_fingerprint=${locatorMap.question_fingerprint} new_fingerprint=${resolution.current_fingerprint}`,
        });
        continue;
      }
      this.#targets.set(action.target_id, target);
      try {
        if (action.kind === "set_selected") {
          this.#setSelected(target, action.value);
        } else if (action.kind === "set_value") {
          this.#setValue(target, action.value);
        } else {
          if (target.kind !== "element") throw new Error("Control target is invalid.");
          target.element.click();
        }
        results.push({ action_id: action.action_id, status: "succeeded" });
      } catch (error) {
        results.push({
          action_id: action.action_id,
          status: "failed",
          message: error instanceof Error ? error.message : "Action failed.",
        });
      }
    }
    return results;
  }

  async readState(signal: AbortSignal): Promise<PlatformState> {
    if (signal.aborted) throw new DOMException("State read cancelled.", "AbortError");
    const selectedTargetIds: string[] = [];
    const fieldValues: Record<string, string> = {};
    for (const [targetId, storedTarget] of this.#targets) {
      const target = this.#resolveLiveTarget(targetId, storedTarget).target;
      if (!target) continue;
      this.#targets.set(targetId, target);
      if (target.kind === "select_option") {
        if (target.element.value === target.value) selectedTargetIds.push(targetId);
      } else if (target.element instanceof HTMLInputElement) {
        if (["radio", "checkbox"].includes(target.element.type) && target.element.checked) {
          selectedTargetIds.push(targetId);
        } else if (!["radio", "checkbox"].includes(target.element.type)) {
          fieldValues[targetId] = target.element.value;
        }
      } else if (target.element instanceof HTMLTextAreaElement) {
        fieldValues[targetId] = target.element.value;
      } else if (target.element.isContentEditable) {
        fieldValues[targetId] = target.element.textContent ?? "";
      } else {
        const checked = target.element.getAttribute("aria-checked");
        if (checked === "true") selectedTargetIds.push(targetId);
      }
    }

    const pageText = normalizedText(this.#document.body?.innerText || this.#document.body?.textContent).slice(-4_000);
    const feedbackText = queryAllDeep<HTMLElement>(
      this.#document,
      "[role='alert'], [aria-live], .feedback, .answer-feedback, .result, [data-feedback]",
    )
      .map(elementText)
      .join(" ");
    const strongPageFeedback = pageText.match(
      /(?:your answer is (?:correct|incorrect)|回答(?:正确|错误)|答(?:对|错)了?)/i,
    )?.[0] ?? "";
    const feedbackEvidence = `${feedbackText} ${strongPageFeedback}`;
    const feedback = /\bcorrect\b|回答正确|答对/i.test(feedbackEvidence)
      ? "correct"
      : /\bincorrect\b|\bwrong\b|回答错误|答错/i.test(feedbackEvidence)
        ? "incorrect"
        : null;
    const editableAnswerTarget = [...this.#targets.entries()].some(([targetId, target]) => {
      if (targetId.startsWith("control_")) return false;
      if (target.kind === "select_option") return !target.element.disabled;
      return !("disabled" in target.element) || !(target.element as HTMLInputElement).disabled;
    });
    const pathname = this.#document.location?.pathname ?? "";
    const completedPath = /\/(?:completed?|results?)\/?$/i.test(pathname);
    const scoredMatches = [...pageText.matchAll(/you got\s+(\d+)\s+out of\s+(\d+)\s+points?/gi)];
    const scoredResult = scoredMatches.length > 0 && this.#fingerprintCurrentQuestion() === "missing";
    const finalScore = scoredMatches.at(-1);
    const visibleScore = this.#readVisibleScore() ?? (finalScore ? `${finalScore[1]}/${finalScore[2]}` : null);
    const position = this.#readQuestionPosition();
    const sessionSubmit = this.#findButton(SESSION_SUBMIT_PATTERN);
    return {
      observation_id: this.#currentObservation?.observation_id ?? "none",
      fingerprint: this.#fingerprintCurrentQuestion(),
      selected_target_ids: selectedTargetIds,
      field_values: fieldValues,
      feedback,
      ...(feedbackEvidence.trim() ? { feedback_text: feedbackEvidence.trim() } : {}),
      ...(visibleScore ? { visible_score: visibleScore } : {}),
      can_retry:
        this.#findButton(RETRY_PATTERN) !== null ||
        (feedback === "incorrect" && editableAnswerTarget),
      has_next: this.#findButton(NEXT_PATTERN) !== null,
      has_session_submit: sessionSubmit !== null,
      at_last_question: position !== null && position.current >= position.total,
      completed:
        completedPath ||
        scoredResult ||
        /quiz complete|test complete|interview complete|completed|your results?|测验完成|测试完成|答题完成|已交卷/i.test(pageText),
    };
  }

  resolveMediaSource(temporaryHandle: string): MediaSource | undefined {
    return this.#mediaSources.get(temporaryHandle);
  }

  detectHardBlocker(): string | null {
    const text = normalizedText(
      collectContexts(this.#document)
        .map((context) =>
          context.nodeType === Node.DOCUMENT_NODE
            ? (context as Document).body?.innerText || (context as Document).body?.textContent
            : context.textContent,
        )
        .join(" "),
    ).slice(0, 8_000);
    if (/captcha|验证码|人机验证|verify you are human/i.test(text)) return "captcha";
    if (/proctor|监考|screen monitoring|屏幕监控/i.test(text)) return "proctoring";
    if (/sign in to continue|login required|请先登录|登录已失效/i.test(text)) return "authentication";
    return null;
  }

  #resolveLiveTarget(targetId: string, target: DomTarget): TargetResolution {
    const currentFingerprint = this.#fingerprintCurrentQuestion();
    if (currentFingerprint !== target.identity.question_fingerprint) {
      return { reason: "question_changed", current_fingerprint: currentFingerprint };
    }
    if (target.element.isConnected) {
      const identity = target.identity;
      const connectedMatches = target.kind === "select_option"
        ? (!identity.input_name || elementInputName(target.element) === identity.input_name) &&
          Array.from(target.element.options).some((option) =>
            option.value === target.value && fnv1a(normalizedText(option.text)) === identity.text_digest,
          )
        : (!identity.input_name || elementInputName(target.element) === identity.input_name) &&
          (!identity.input_value || elementInputValue(target.element) === identity.input_value) &&
          fnv1a(targetText(this.#document, target.element)) === identity.text_digest;
      if (connectedMatches) return { target, current_fingerprint: currentFingerprint };
    }

    const root = this.#activeRoot();
    if (!root) return { reason: "node_detached", current_fingerprint: currentFingerprint };
    const matchesIdentity = (element: HTMLElement): boolean => {
      const identity = target.identity;
      return (!identity.input_name || elementInputName(element) === identity.input_name) &&
        (!identity.input_value || elementInputValue(element) === identity.input_value) &&
        fnv1a(targetText(this.#document, element)) === identity.text_digest;
    };
    const choose = (candidates: HTMLElement[]): TargetResolution => {
      const semanticMatches = candidates.filter(matchesIdentity);
      if (semanticMatches.length === 1) {
        return {
          target: { kind: "element", element: semanticMatches[0]!, identity: target.identity },
          current_fingerprint: currentFingerprint,
        };
      }
      return {
        reason: semanticMatches.length > 1 ? "semantic_match_ambiguous" : "semantic_match_failed",
        current_fingerprint: currentFingerprint,
      };
    };

    if (target.kind === "select_option") {
      const selects = Array.from(root.querySelectorAll<HTMLSelectElement>("select:not([multiple])"))
        .filter((element) => !isExplicitlyHidden(element) && supportedInput(element))
        .filter((element) =>
          (!target.identity.input_name || elementInputName(element) === target.identity.input_name) &&
          Array.from(element.options).some((option) =>
            option.value === target.value && fnv1a(normalizedText(option.text)) === target.identity.text_digest,
          ),
        );
      return selects.length === 1
        ? {
            target: { kind: "select_option", element: selects[0]!, value: target.value, identity: target.identity },
            current_fingerprint: currentFingerprint,
          }
        : {
            reason: selects.length > 1 ? "semantic_match_ambiguous" : "semantic_match_failed",
            current_fingerprint: currentFingerprint,
          };
    }

    if (targetId.startsWith("opt_")) {
      return choose(Array.from(root.querySelectorAll<HTMLElement>(
        "input[type='radio'], input[type='checkbox'], [role='radio'], [role='checkbox']",
      )).filter((element) => !isExplicitlyHidden(element) && supportedInput(element)));
    }
    if (targetId.startsWith("blank_")) {
      return choose(Array.from(root.querySelectorAll<HTMLElement>(
        "input[type='text'], input[type='number'], input:not([type]), textarea, [contenteditable='true']",
      )).filter((element) => !isExplicitlyHidden(element) && supportedInput(element)));
    }

    const candidates = targetId.startsWith("candidate_control_")
      ? queryAllDeep<HTMLElement>(this.#document, "button, input[type='submit'], input[type='button'], [role='button'], a")
      : targetId === "control_submit"
      ? [
          ...Array.from(root.querySelectorAll<HTMLElement>("button[type='submit'], input[type='submit']")),
          ...Array.from(root.querySelectorAll<HTMLElement>("button, input[type='button'], [role='button']"))
            .filter((element) => SUBMIT_PATTERN.test(targetText(this.#document, element))),
        ]
      : targetId === "control_submit_session"
        ? queryAllDeep<HTMLElement>(this.#document, "button, input[type='submit'], input[type='button'], [role='button']")
            .filter((element) => SESSION_SUBMIT_PATTERN.test(targetText(this.#document, element)))
        : targetId === "control_next"
          ? queryAllDeep<HTMLElement>(this.#document, "button, input[type='submit'], input[type='button'], [role='button']")
              .filter((element) => NEXT_PATTERN.test(targetText(this.#document, element)))
          : targetId === "control_retry"
            ? queryAllDeep<HTMLElement>(this.#document, "button, input[type='submit'], input[type='button'], [role='button']")
                .filter((element) => RETRY_PATTERN.test(targetText(this.#document, element)))
            : [];
    return choose([...new Set(candidates)].filter((element) => !isExplicitlyHidden(element) && supportedInput(element)));
  }

  #registerCandidateControls(locatorMap: LocatorMap): NonNullable<PlatformObservation["local_control_candidates"]> {
    const knownElements = new Map<HTMLElement, string>();
    for (const [semanticId, target] of this.#targets) knownElements.set(target.element, semanticId);
    const candidates = queryAllDeep<HTMLElement>(
      this.#document,
      "button, input[type='submit'], input[type='button'], [role='button'], a[href]",
    ).filter((element) => !isExplicitlyHidden(element) && supportedInput(element));

    let candidateIndex = 0;
    const localCandidates: NonNullable<PlatformObservation["local_control_candidates"]> = [];
    for (const element of candidates) {
      if (knownElements.has(element)) continue;
      const text = targetText(this.#document, element);
      if (!text || text.length > 200) continue;
      candidateIndex += 1;
      const semanticId = `candidate_control_${candidateIndex}`;
      locatorMap.targets[semanticId] = { kind: "semantic", local_ref: randomId("node"), role: "button_candidate" };
      this.#targets.set(semanticId, {
        kind: "element",
        element,
        identity: { ...targetIdentity(this.#document, element, "candidate"), question_fingerprint: locatorMap.question_fingerprint },
      });
      knownElements.set(element, semanticId);
      localCandidates.push({
        semantic_id: semanticId,
        text,
        disabled: element.getAttribute("aria-disabled") === "true" || ("disabled" in element && Boolean((element as HTMLButtonElement).disabled)),
      });
      if (candidateIndex >= 128) break;
    }
    return localCandidates;
  }

  #buildPageContext(
    root: HTMLElement,
    mode: Exclude<ObservationInputMode, "structured">,
  ): NonNullable<PlatformObservation["page_context"]> {
    const controls = [...this.#targets.entries()].slice(0, 256).map(([semanticId, target]) => {
      const element = target.element;
      const selected = element instanceof HTMLInputElement
        ? element.checked
        : element.getAttribute("aria-checked") === "true" || element.getAttribute("aria-selected") === "true";
      const disabled = element.getAttribute("aria-disabled") === "true" ||
        ("disabled" in element && Boolean((element as HTMLInputElement | HTMLButtonElement | HTMLSelectElement).disabled));
      return {
        semantic_id: semanticId,
        role: target.identity.role,
        text: target.kind === "select_option"
          ? normalizedText(Array.from(target.element.options).find((option) => option.value === target.value)?.text)
          : targetText(this.#document, element),
        selected,
        disabled,
      };
    });

    const body = this.#document.body;
    let visibleText = normalizedText(body?.innerText).slice(0, 20_000);
    if (!visibleText && body) {
      const clone = body.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("script, style, noscript, template, [hidden], input[type='password']").forEach((element) => element.remove());
      visibleText = normalizedText(clone.textContent).slice(0, 20_000);
    }
    const questionText = normalizedText(root.innerText || root.textContent).slice(0, 8_000);
    if (questionText && !visibleText.includes(questionText)) visibleText = `${questionText}\n${visibleText}`.slice(0, 20_000);
    return { mode, visible_text: visibleText, controls, media: [] };
  }

  #parseQuestion(root: HTMLElement, sessionId: string, observationId: string) {
    const ownerDocument = root.ownerDocument;
    const stem = semanticStem(ownerDocument, root);
    const stemText = stem.text;
    const radioControls = Array.from(root.querySelectorAll<HTMLElement>("input[type='radio'], [role='radio']"))
      .filter((element) => !isExplicitlyHidden(element));
    const checkboxControls = Array.from(root.querySelectorAll<HTMLElement>("input[type='checkbox'], [role='checkbox']"))
      .filter((element) => !isExplicitlyHidden(element));
    const select = root.querySelector<HTMLSelectElement>("select:not([multiple])");
    const textControls = Array.from(
      root.querySelectorAll<HTMLElement>("input[type='text'], input[type='number'], input:not([type]), textarea, [contenteditable='true']"),
    ).filter((element) => !isExplicitlyHidden(element) && supportedInput(element));

    const optionControls = radioControls.length > 0 ? radioControls : checkboxControls;
    const type: QuestionFrame["type"] =
      radioControls.length > 0 || select
        ? "single_choice"
        : checkboxControls.length > 0
          ? "multiple_choice"
          : "fill_blank";
    const options: QuestionFrame["options"] = [];
    const blanks: QuestionFrame["blanks"] = [];
    const targets: LocatorMap["targets"] = {};

    if (select) {
      Array.from(select.options)
        .filter((option) => !option.disabled && option.value !== "")
        .forEach((option, index) => {
          const id = `opt_${index + 1}`;
          const localRef = randomId("node");
          options.push({ id, text: normalizedText(option.text), media: [] });
          targets[id] = { kind: "semantic", local_ref: localRef, role: "option" };
          this.#targets.set(id, {
            kind: "select_option",
            element: select,
            value: option.value,
            identity: {
              role: "option",
              question_fingerprint: "pending",
              input_name: elementInputName(select),
              input_value: option.value,
              text_digest: fnv1a(normalizedText(option.text)),
            },
          });
        });
    } else if (type !== "fill_blank") {
      optionControls.forEach((control, index) => {
        const id = `opt_${index + 1}`;
        const localRef = randomId("node");
        const label = optionLabel(ownerDocument, control) || `Option ${index + 1}`;
        const labelElement = control.closest("label") ??
          (control.id ? ownerDocument.querySelector(`label[for='${CSS.escape(control.id)}']`) : null);
        const media = Array.from((labelElement ?? control).querySelectorAll<HTMLImageElement>("img"))
          .map((image) => imageMedia(image, this.#mediaSources, "option_image"))
          .filter((item): item is MediaRef => item !== null);
        options.push({ id, text: label, media });
        targets[id] = { kind: "semantic", local_ref: localRef, role: type === "single_choice" ? "radio" : "checkbox" };
        this.#targets.set(id, { kind: "element", element: control, identity: targetIdentity(ownerDocument, control, "option") });
      });
    } else {
      textControls.forEach((control, index) => {
        const id = `blank_${index + 1}`;
        const localRef = randomId("node");
        blanks.push({
          id,
          label: labelText(ownerDocument, control),
          required: control.hasAttribute("required") || control.getAttribute("aria-required") === "true",
          ...(control instanceof HTMLInputElement && control.maxLength > 0
            ? { max_length: control.maxLength }
            : {}),
        });
        targets[id] = { kind: "semantic", local_ref: localRef, role: "textbox" };
        this.#targets.set(id, { kind: "element", element: control, identity: targetIdentity(ownerDocument, control, "blank") });
      });
    }

    const nativeSubmit = Array.from(
      root.querySelectorAll<HTMLElement>("button[type='submit'], input[type='submit']"),
    ).find((element) => !isExplicitlyHidden(element) && supportedInput(element));
    const submit = nativeSubmit && !NEXT_PATTERN.test(targetText(ownerDocument, nativeSubmit))
      ? nativeSubmit
      : this.#findButton(SUBMIT_PATTERN, root);
    if (submit) {
      const localRef = randomId("node");
      targets.control_submit = { kind: "semantic", local_ref: localRef, role: "button" };
      this.#targets.set("control_submit", { kind: "element", element: submit, identity: targetIdentity(ownerDocument, submit, "submit") });
    }
    const next = this.#findButton(NEXT_PATTERN, root) ?? this.#findButton(NEXT_PATTERN);
    if (next && next !== submit) {
      const localRef = randomId("node");
      targets.control_next = { kind: "semantic", local_ref: localRef, role: "button" };
      this.#targets.set("control_next", { kind: "element", element: next, identity: targetIdentity(ownerDocument, next, "next") });
    }
    const retry = this.#findButton(RETRY_PATTERN, root) ?? this.#findButton(RETRY_PATTERN);
    if (retry) {
      const localRef = randomId("node");
      targets.control_retry = { kind: "semantic", local_ref: localRef, role: "button" };
      this.#targets.set("control_retry", { kind: "element", element: retry, identity: targetIdentity(ownerDocument, retry, "retry") });
    }
    const sessionSubmit = this.#findButton(SESSION_SUBMIT_PATTERN, this.#document, true);
    if (sessionSubmit && !root.contains(sessionSubmit) && sessionSubmit !== submit) {
      const localRef = randomId("node");
      targets.control_submit_session = { kind: "semantic", local_ref: localRef, role: "button" };
      this.#targets.set("control_submit_session", {
        kind: "element",
        element: sessionSubmit,
        identity: targetIdentity(ownerDocument, sessionSubmit, "session_submit"),
      });
    }

    const stemImages = Array.from(root.querySelectorAll<HTMLImageElement>("img"))
      .filter((image) => !image.closest("label"))
      .map((image) => imageMedia(image, this.#mediaSources, "question_diagram"))
      .filter((item): item is MediaRef => item !== null);
    const fingerprintSource = JSON.stringify({ type, stemText, options: options.map((option) => option.text), blanks: blanks.length });
    const questionFingerprint = fnv1a(fingerprintSource);
    for (const target of this.#targets.values()) target.identity.question_fingerprint = questionFingerprint;
    const questionId = `q_${questionFingerprint}`;
    const question: QuestionFrame = {
      schema_version: SCHEMA_VERSION,
      session_id: sessionId,
      question_id: questionId,
      observation_id: observationId,
      type,
      stem: { text: stemText, format: stem.hasMath ? "math_text" : "plain_text", media: stemImages },
      options,
      blanks,
      constraints:
        type === "single_choice"
          ? { min_selections: 1, max_selections: 1 }
          : type === "multiple_choice"
            ? {
                min_selections: Number(root.getAttribute("data-min-selections") ?? 1),
                max_selections: Number(root.getAttribute("data-max-selections") ?? options.length),
              }
            : { min_selections: 0, max_selections: 0 },
      provenance: { text_source: "dom", untrusted_content: true },
    };
    const locatorMap: LocatorMap = {
      schema_version: SCHEMA_VERSION,
      session_id: sessionId,
      question_id: questionId,
      observation_id: observationId,
      platform: "web",
      question_fingerprint: questionFingerprint,
      targets,
    };
    return { question, locator_map: locatorMap };
  }

  #setSelected(target: DomTarget, value: boolean): void {
    if (target.kind === "select_option") {
      if (value && target.element.value !== target.value) {
        target.element.value = target.value;
        dispatchValueEvents(target.element);
      }
      return;
    }
    const element = target.element;
    if (element instanceof HTMLInputElement && ["radio", "checkbox"].includes(element.type)) {
      if (element.disabled) throw new Error("Target is disabled.");
      if (element.checked !== value) element.click();
      return;
    }
    const current = element.getAttribute("aria-checked") === "true";
    if (current !== value) element.click();
  }

  #setValue(target: DomTarget, value: string): void {
    if (target.kind !== "element") throw new Error("Text target is invalid.");
    const element = target.element;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (element.disabled || element.readOnly) throw new Error("Target is not editable.");
      element.focus();
      element.value = value;
      dispatchValueEvents(element);
    } else if (element.isContentEditable) {
      element.focus();
      element.textContent = value;
      dispatchValueEvents(element);
    } else {
      throw new Error("Target is not a supported text field.");
    }
  }

  #findButton(pattern: RegExp, within: ParentNode = this.#document, includeDisabled = false): HTMLElement | null {
    const candidates =
      within === this.#document
        ? queryAllDeep<HTMLElement>(this.#document, "button, input[type='submit'], input[type='button'], [role='button']")
        : Array.from(within.querySelectorAll<HTMLElement>("button, input[type='submit'], input[type='button'], [role='button']"));
    return (
      candidates
        .filter((element) => !isExplicitlyHidden(element) && (includeDisabled || supportedInput(element)))
        .find((element) => pattern.test(normalizedText(
          element instanceof HTMLInputElement ? element.value : element.getAttribute("aria-label") || element.textContent,
        ))) ?? null
    );
  }

  #fingerprintCurrentQuestion(): string {
    const root = this.#activeRoot();
    if (!root) return "missing";
    const stem = semanticStem(root.ownerDocument, root).text;
    const radioControls = Array.from(root.querySelectorAll<HTMLElement>("input[type='radio'], [role='radio']"))
      .filter((element) => !isExplicitlyHidden(element));
    const checkboxControls = Array.from(root.querySelectorAll<HTMLElement>("input[type='checkbox'], [role='checkbox']"))
      .filter((element) => !isExplicitlyHidden(element));
    const select = root.querySelector<HTMLSelectElement>("select:not([multiple])");
    const type = radioControls.length > 0 || select
      ? "single_choice"
      : checkboxControls.length > 0
        ? "multiple_choice"
        : "fill_blank";
    const options = select
      ? Array.from(select.options)
          .filter((option) => !option.disabled && option.value !== "")
          .map((option) => normalizedText(option.text))
      : (radioControls.length > 0 ? radioControls : checkboxControls)
          .map((element, index) => optionLabel(root.ownerDocument, element) || `Option ${index + 1}`);
    const blanks = type === "fill_blank"
      ? Array.from(root.querySelectorAll<HTMLElement>("input[type='text'], input[type='number'], input:not([type]), textarea, [contenteditable='true']"))
          .filter((element) => !isExplicitlyHidden(element) && supportedInput(element)).length
      : 0;
    return fnv1a(JSON.stringify({ type, stemText: stem, options, blanks }));
  }

  #readTimer(): number | null {
    const timer = queryAllDeep<HTMLElement>(
      this.#document,
      "[data-remaining-seconds], [role='timer'], .timer, .countdown",
    )[0];
    if (!timer) return null;
    const explicit = timer.getAttribute("data-remaining-seconds");
    if (explicit && /^\d+$/.test(explicit)) return Number(explicit);
    const match = elementText(timer).match(/(?:(\d+):)?(\d{1,2}):(\d{2})/);
    if (!match) return null;
    return Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  }

  #readQuestionTotal(): number | null {
    const explicit = queryAllDeep<HTMLElement>(this.#document, "[data-total-questions]")[0]
      ?.getAttribute("data-total-questions");
    if (explicit && /^\d+$/.test(explicit)) return Number(explicit);
    const progress = queryAllDeep<HTMLElement>(
      this.#document,
      "[role='progressbar'], .quiz-progress, .question-progress, [data-progress]",
    )
      .map(elementText)
      .join(" ");
    const match = progress.match(/(?:question\s*)?\d+\s*(?:of|\/|共)\s*(\d+)/i);
    if (match) return Number(match[1]);
    const pageMatch = normalizedText(this.#document.body?.innerText || this.#document.body?.textContent)
      .match(/(?:question|题目)\s*\d+\s*(?:of|\/|共)\s*(\d+)/i);
    return pageMatch ? Number(pageMatch[1]) : null;
  }

  #readQuestionPosition(): { current: number; total: number } | null {
    const root = this.#activeRoot();
    const sources = [
      root ? elementText(root) : "",
      normalizedText(this.#document.body?.innerText || this.#document.body?.textContent),
    ];
    for (const source of sources) {
      const matches = [...source.matchAll(/(?:question|题目)\s*(\d+)\s*(?:of|\/|共)\s*(\d+)/gi)];
      const match = matches.at(-1);
      if (match) return { current: Number(match[1]), total: Number(match[2]) };
    }
    return null;
  }

  #readVisibleScore(): string | null {
    const score = queryAllDeep<HTMLElement>(this.#document, "[data-score], .score, .quiz-score, .grade")
      .map((element) => element.getAttribute("data-score") || elementText(element))
      .find(Boolean);
    return score ? normalizedText(score) : null;
  }
}
