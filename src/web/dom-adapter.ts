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
import { SeparationTrial, cleanedVisibleText } from "./separation-trial";
import type { InitialSemanticSnapshot, InitialSemanticReading } from "./initial-snapshot";
import type { LocalStructure, SeparationRoles, SeparationSnapshot } from "./separation-trial";
import { ZHIDAO_CHOICE_SELECTOR, ZHIDAO_NEXT_SELECTOR, isZhidaoChoice, isZhidaoNext, readZhidaoPractice, resolveZhidaoPracticeSubmit, zhidaoRadioRoot, zhidaoPracticeRoot, zhidaoSelected, zhidaoStem } from './zhidao-practice';

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
  "[data-question-id]",
  ".quiz-question",
  ".question",
  ".question-card",
  "fieldset",
  "form",
  "[role='radiogroup']",
  "[role='group']",
  ".exam-test .questionContent",
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
  ZHIDAO_CHOICE_SELECTOR,
].join(",");

const SUBMIT_PATTERN = /^(?:submit(?:\s+\d+\s+answers?)?|finish(?:\s+quiz)?|check|confirm|提交|确认|交卷|检查答案|完成)$/i;
const SESSION_SUBMIT_PATTERN = /^(?:submit(?:\s+(?:(?:the\s+)?(?:test|quiz|interview)|\d+\s+answers?|answers?))|finish(?:\s+(?:(?:the\s+)?(?:test|quiz|interview)))|提交试卷|完成测试|结束测验)$/i;
const NEXT_PATTERN = /^(next(?:\s+question)?|continue|下一题|继续|下一步)\s*(?:→|›|»|❯|>)?$/i;
const RETRY_PATTERN = /^(retry|try again|重试|再试一次|重新作答)$/i;

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function supportedInput(element: Element): boolean {
  if (element.matches(ZHIDAO_CHOICE_SELECTOR) && !isZhidaoChoice(element)) return false;
  if (element.matches(ZHIDAO_NEXT_SELECTOR) && !isZhidaoNext(element)) return false;
  if (element.getAttribute("aria-disabled") === "true") return false;
  if ("disabled" in element && (element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement).disabled) {
    return false;
  }
  if (element.tagName !== "INPUT") return true;
  return !["password", "file", "hidden", "submit", "button", "reset"].includes((element as HTMLInputElement).type);
}

function hasVisibleQuestionSetGrade(root: HTMLElement): boolean {
  return root.matches('.h5p-question') && Boolean(root.closest('.questionset')) &&
    Array.from(root.querySelectorAll('.h5p-question-feedback.h5p-question-visible, .h5p-question-scorebar.h5p-question-visible'))
      .some(feedback=>!isExplicitlyHidden(feedback));
}

function choiceControls(root: HTMLElement, role: 'radio' | 'checkbox'): HTMLElement[] {
  if (zhidaoRadioRoot(root) === root) {
    // The root is already validated. Resolve its direct choice list locally
    // rather than asking a descendant query to match ancestors outside it.
    return role === 'radio' ? Array.from(root.querySelectorAll<HTMLElement>(':scope > ul.radio-view > li.clearfix')).filter(isZhidaoChoice) : [];
  }
  // H5P MultiChoice removes roles after grading but leaves the same labelled
  // alternatives in its radio/check container. Recover observation semantics
  // only; aria-disabled still prevents executing answer actions on these nodes.
  const gradedSelector = hasVisibleQuestionSetGrade(root) && root.matches('.h5p-multichoice')
    ? `, .h5p-question-content.${role === 'radio' ? 'h5p-radio' : 'h5p-check'} .h5p-answer`
    : '';
  return Array.from(root.querySelectorAll<HTMLElement>(`input[type='${role}'], [role='${role}']${gradedSelector}`))
    .filter(element=>!isExplicitlyHidden(element));
}

function selectedChoice(element: HTMLElement): boolean {
  if (isZhidaoChoice(element)) return zhidaoSelected(element);
  if (element.tagName === "INPUT" && ["radio", "checkbox"].includes((element as HTMLInputElement).type)) {
    return (element as HTMLInputElement).checked;
  }
  return element.getAttribute("aria-checked") === "true" ||
    element.getAttribute("aria-selected") === "true" ||
    ((element.getAttribute("role") === "radio" || element.getAttribute("role") === "checkbox") &&
      element.classList.contains("h5p-sc-selected"));
}

function optionLabel(document: Document, control: HTMLElement): string {
  if (isZhidaoChoice(control)) return elementText(control.querySelector(':scope > .stem'));
  const zhidaoRoot = zhidaoPracticeRoot(control);
  if (zhidaoRoot && control.matches('input.el-checkbox__original[type="checkbox"]')) {
    return elementText(control.closest('label.el-checkbox')?.querySelector(':scope > .el-checkbox__label > pre.preStyle') ?? null);
  }
  if (control.matches('.h5p-answer')) {
    const alternative = control.querySelector('.h5p-alternative-inner');
    if (alternative) return elementText(alternative);
  }
  const labelElement = control.closest("label") ??
    (control.id ? document.querySelector<HTMLElement>(`label[for='${CSS.escape(control.id)}']`) : null) ??
    control;
  const clone = labelElement.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("input, textarea, select, button, .h5p-true-false-answer .aria-label")
    .forEach((element) => element.remove());
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
  const h5pQuestions = queryAllDeep<HTMLElement>(document, ".h5p-question")
    .filter((element) => !isExplicitlyHidden(element))
    .filter((element) => {
      // Graded H5P choices can be disabled until a newly created Retry button
      // resets them. They still describe the same question for re-observation.
      const graded=hasVisibleQuestionSetGrade(element);
      if (graded && element.matches('.h5p-multichoice') &&
        choiceControls(element, 'radio').length + choiceControls(element, 'checkbox').length > 0) return true;
      return Array.from(element.querySelectorAll(SUPPORTED_CONTROL_SELECTOR))
        .some(control=>!isExplicitlyHidden(control)&&(supportedInput(control)||graded));
    });
  if (h5pQuestions.length > 0) return h5pQuestions;
  const explicit = queryAllDeep<HTMLElement>(document, QUESTION_ROOT_SELECTORS.join(","))
    .filter((element) => !isExplicitlyHidden(element))
    .filter((element) => zhidaoPracticeRoot(element) === element ||
      Array.from(element.querySelectorAll(SUPPORTED_CONTROL_SELECTOR)).some(supportedInput));
  if (explicit.length > 0) {
    const leaves = explicit.filter((candidate) => !explicit.some((other) => other !== candidate && candidate.contains(other)));
    const candidates = leaves.length > 0 ? leaves : explicit;
    if (candidates.length === 1) {
      const grouped = nativeRadioQuestionRoots(candidates[0]!);
      if (grouped) return grouped;
    }
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

function nativeRadioQuestionRoots(root: HTMLElement): HTMLElement[] | null {
  const controls = Array.from(root.querySelectorAll<HTMLElement>(SUPPORTED_CONTROL_SELECTOR))
    .filter(control => !isExplicitlyHidden(control) && supportedInput(control));
  if (controls.some(control => !control.matches("input[type='radio'][name]"))) return null;
  const groups = new Map<string, HTMLInputElement[]>();
  for (const control of controls as HTMLInputElement[]) {
    if (!control.name) return null;
    const group = groups.get(control.name) ?? [];
    group.push(control); groups.set(control.name, group);
  }
  if (groups.size < 2) return null;
  const regions: HTMLElement[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) return null;
    let region = group[0]!.parentElement;
    while (region && region !== root && !group.every(control => region!.contains(control))) region = region.parentElement;
    if (!region || region === root) return null;
    // Widen only within this group, so its visible stem/images are included.
    while (region.parentElement && region.parentElement !== root &&
      controls.filter(control => region!.parentElement!.contains(control)).length === group.length) region = region.parentElement;
    if (controls.filter(control => region!.contains(control)).length !== group.length ||
      !region.querySelector("p,h1,h2,h3,h4,h5,h6,legend,[data-question-stem],.question-text,.question-title") ||
      !questionStem(root.ownerDocument, region)) return null;
    regions.push(region);
  }
  if (new Set(regions).size !== groups.size || regions.some(left => regions.some(right => left !== right && left.contains(right)))) return null;
  return regions;
}

function questionRootScore(root: HTMLElement): number {
  if (root.closest("header, nav, aside, [role='search']")) return -1_000;
  if (zhidaoPracticeRoot(root) === root) return 230;
  const choiceControls = root.querySelectorAll(
    "input[type='radio'], input[type='checkbox'], [role='radio'], [role='checkbox']",
  ).length;
  const selects = root.querySelectorAll("select:not([multiple])").length;
  const textControls = root.querySelectorAll(
    "input[type='text'], input[type='number'], input:not([type]), textarea, [contenteditable='true']",
  ).length;
  const questionMarker = root.matches("[data-vv-question], [data-question], [data-question-id], .quiz-question, .question, .question-card, fieldset") ? 30 : 0;
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
  if (isZhidaoChoice(element) || element.matches("input[type='radio'], input[type='checkbox'], [role='radio'], [role='checkbox']")) {
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
  const practiceStem = zhidaoStem(root);
  if (practiceStem) return practiceStem;
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
  const semantic = root.querySelector<HTMLElement>("[data-question-stem], .question-text, .question-title, .stem");
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

function blankQuestionStem(root: HTMLElement, controls: HTMLElement[], heading: string): string {
  const placeholders = new Map<Node, string>(controls.map((control, index) => [control, `[blank_${index + 1}]`]));
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const element = node as Element;
    if (isExplicitlyHidden(element) || element.matches(
      "button, a, script, style, noscript, template, .h5p-question-feedback, .h5p-question-scorebar, .h5p-solution, .h5p-question .hidden-but-read, [role='alert'], [role='status'], [aria-live]:not([aria-live='off'])",
    )) return "";
    const placeholder = placeholders.get(node);
    if (placeholder) return ` ${placeholder} `;
    if (element.matches("input, textarea, select, [contenteditable='true']")) return "";
    const content = Array.from(node.childNodes).map(walk).join("");
    return /^(?:P|DIV|SECTION|ARTICLE|LI|BR|H[1-6])$/.test(element.tagName) ? `\n${content}\n` : content;
  };
  const context = normalizedText(walk(root)).slice(0, 4_000);
  if (!context) return heading;
  return heading && !context.includes(heading) ? `${heading}\n${context}`.slice(0, 4_000) : context;
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
  #initialCandidates = new Map<string, { root: HTMLElement; fingerprint: string }>();
  #initialRoots: HTMLElement[] = [];
  #initialDocumentIdentity: string | null = null;
  #pageQuestions: Array<{ adapter: DomWebAdapter; prefix: string; parsed: PlatformObservation["questions"][number] }> = [];

  constructor(document: Document, private readonly rootOverride?: HTMLElement, private readonly courseScope?: HTMLElement) {
    this.#document = document;
    this.#separationTrial = new SeparationTrial(document);
  }

  /** Release only our temporary references; the website's answers stay intact. */
  release(): void {
    for (const item of this.#pageQuestions) item.adapter.release();
    this.#pageQuestions = [];
    this.#targets.clear();
    this.#mediaSources.clear();
    this.#currentObservation = undefined;
    this.#currentLocator = undefined;
    this.#calibratedRoot = null;
    this.#initialCandidates.clear();
    this.#initialRoots = [];
    this.#initialDocumentIdentity = null;
    this.#separationTrial = new SeparationTrial(this.#document);
  }

  captureSeparation(): { snapshot: SeparationSnapshot; suggested: boolean } {
    const snapshot = this.#separationTrial.capture();
    const currentStem = this.#currentObservation?.questions[0]?.question.stem.text ?? "";
    const suggested = this.#separationTrial.candidateStems().some((stem) =>
      stem.length >= 8 && /[?？]|question|题/i.test(stem) && !currentStem.includes(stem),
    );
    return { snapshot, suggested };
  }

  captureInitialSemantic(): InitialSemanticSnapshot {
    const blocker = this.detectHardBlocker();
    if (blocker) throw new Error(`HARD_BLOCKER:${blocker}`);
    this.#initialCandidates.clear();
    this.#initialDocumentIdentity = this.#documentIdentity();
    const regions = candidateRoots(this.#document).filter(root => root.ownerDocument === this.#document).slice(0, 64).map(root => {
      const region_id = randomId("initial_region");
      this.#initialCandidates.set(region_id, { root, fingerprint: this.#initialFingerprint(root) });
      return { region_id, text: cleanedVisibleText(root.ownerDocument, root, 4_000),
        controls: Array.from(root.querySelectorAll<HTMLElement>(SUPPORTED_CONTROL_SELECTOR)).filter(e => !isExplicitlyHidden(e)).slice(0, 64)
          .map(e => ({ role: isZhidaoChoice(e) ? 'radio' : e.getAttribute("role") || (e.tagName === "INPUT" ? (e as HTMLInputElement).type : e.tagName.toLowerCase()),
            text: (isZhidaoChoice(e) ? optionLabel(root.ownerDocument, e) : labelText(root.ownerDocument, e)).slice(0, 300), disabled: !supportedInput(e) })) };
    });
    // Empty candidates still go to the model; discovery is not a readiness gate.
    return { visible_text: cleanedVisibleText(this.#document, this.#document.body, 20_000), regions };
  }

  #initialFingerprint(root: HTMLElement): string {
    return fnv1a(JSON.stringify([elementText(root), Array.from(root.querySelectorAll<HTMLElement>(SUPPORTED_CONTROL_SELECTOR))
      .map(e => [e.tagName, e.getAttribute("role"), elementInputName(e), elementInputValue(e), supportedInput(e), isExplicitlyHidden(e)])]));
  }

  #documentIdentity(): string {
    return JSON.stringify([this.#document.location.href, this.#document.defaultView?.performance.timeOrigin]);
  }

  applyInitialSemantic(reading: InitialSemanticReading): boolean {
    const blocker = this.detectHardBlocker();
    if (blocker) throw new Error(`HARD_BLOCKER:${blocker}`);
    if (this.#initialDocumentIdentity !== this.#documentIdentity() || !reading.region_ids.length ||
      new Set(reading.region_ids).size !== reading.region_ids.length) return false;
    const chosen = reading.region_ids.map(id => this.#initialCandidates.get(id));
    if (chosen.some(item => !item || !item.root.isConnected || isExplicitlyHidden(item.root) ||
      item.fingerprint !== this.#initialFingerprint(item.root))) return false;
    const roots = chosen.map(item => item!.root);
    if (roots.some(root => roots.some(other => root !== other && root.contains(other)))) return false;
    if (roots.some((root, index) => index > 0 &&
      !(roots[index - 1]!.compareDocumentPosition(root) & Node.DOCUMENT_POSITION_FOLLOWING))) return false;
    this.#initialRoots = roots;
    this.#initialCandidates.clear();
    this.#initialDocumentIdentity = null;
    return true;
  }

  #liveInitialRoots(): HTMLElement[] {
    if (this.#initialRoots.some(root => !root.isConnected || isExplicitlyHidden(root))) this.#initialRoots = [];
    return this.#initialRoots;
  }

  isQuizInteractionTarget(target: EventTarget | null): boolean {
    const ElementClass = this.#document.defaultView?.Element;
    if (!ElementClass || !(target instanceof ElementClass)) return false;
    if (target.closest("header,nav,aside,footer,[role='search']")) return false;
    if (this.#pageQuestions.some(entry => entry.adapter.isQuizInteractionTarget(target))) return true;
    const roots = [this.#activeRoot(), ...candidateRoots(this.#document)];
    if (roots.some(root => root?.contains(target))) return true;
    if (target.closest("canvas")) return true;
    return [...this.#targets.values()].some(item => item.identity.role !== "candidate" && (item.element === target || item.element.contains(target)));
  }

  applySeparation(roles: SeparationRoles): LocalStructure | null {
    const separated = this.#separationTrial.separate(roles);
    if (!separated || !this.#separationTrial.remember(roles)) return null;
    this.#initialRoots = [];
    this.#calibratedRoot = this.#separationTrial.validate(roles);
    return this.#separationTrial.structure();
  }

  reuseSeparation(structure: LocalStructure): boolean {
    this.#initialRoots = [];
    this.#separationTrial = new SeparationTrial(this.#document, structure);
    this.#calibratedRoot = this.#separationTrial.reuse();
    if (!this.#calibratedRoot) this.#separationTrial = new SeparationTrial(this.#document);
    return this.#calibratedRoot !== null;
  }

  #activeRoot(): HTMLElement | undefined {
    if (this.rootOverride) return this.rootOverride.isConnected && !isExplicitlyHidden(this.rootOverride) ? this.rootOverride : undefined;
    if (this.#liveInitialRoots().length) return this.#initialRoots[0];
    if (this.#calibratedRoot?.isConnected && !isExplicitlyHidden(this.#calibratedRoot)) return this.#calibratedRoot;
    if (this.#separationTrial.structure()) {
      this.#calibratedRoot = this.#separationTrial.reuse();
      if (this.#calibratedRoot) return this.#calibratedRoot;
      return undefined;
    }
    return candidateRoots(this.#document).filter(root => !this.courseScope || this.courseScope.contains(root))[0];
  }

  capabilities(): PlatformCapabilities {
    return {
      question_types: ["single_choice", "multiple_choice", "fill_blank"],
      multi_question_page: true,
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
      const roots = (this.#liveInitialRoots().length ? this.#initialRoots : this.#calibratedRoot?.isConnected ? [this.#calibratedRoot] : candidateRoots(this.#document))
        .filter(root=>!this.courseScope||this.courseScope.contains(root));
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
    const roots = this.#liveInitialRoots().length ? this.#initialRoots : this.rootOverride || this.#separationTrial.structure() ? (activeRoot ? [activeRoot] : []) : candidateRoots(this.#document).filter(root => !this.courseScope || this.courseScope.contains(root));
    if (roots.length === 0) throw new Error("No supported question was found.");
    if (roots.length > 1 && !this.rootOverride) return this.#observePage(roots, sessionId, signal, mode);
    this.#pageQuestions = [];
    const root = roots[0]!;
    if (Array.from(root.querySelectorAll("textarea, [contenteditable='true']"))
      .some((element) => !isExplicitlyHidden(element) && supportedInput(element))) {
      throw new Error("HARD_BLOCKER:unsupported_subjective_question");
    }
    const radioNames = new Set(
      Array.from(root.querySelectorAll<HTMLInputElement>("input[type='radio'][name]"))
        .filter(input => !isExplicitlyHidden(input) && supportedInput(input))
        .map((input) => input.name)
        .filter(Boolean),
    );
    if (radioNames.size > 1) throw new Error("HARD_BLOCKER:ambiguous_native_question_groups");
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
    if (this.#pageQuestions.length) {
      const entry = this.#pageQuestions.find(item => `${item.prefix}${item.parsed.question.question_id}` === plan.question_id);
      if (!entry || !this.#currentObservation || plan.session_id !== this.#currentObservation.session_id || locatorMap.session_id !== plan.session_id || locatorMap.question_id !== plan.question_id || plan.observation_id !== this.#currentObservation.observation_id || locatorMap.observation_id !== plan.observation_id || locatorMap.question_fingerprint !== entry.parsed.locator_map.question_fingerprint) throw new Error("PAGE_CHANGED multi-question execution context mismatch");
      if (plan.actions.some(action => !action.target_id.startsWith(entry.prefix) || !entry.parsed.locator_map.targets[action.target_id.slice(entry.prefix.length)])) throw new Error("TARGET_UNAVAILABLE action belongs to another question");
      return entry.adapter.execute({ ...plan, question_id: entry.parsed.question.question_id, observation_id: entry.parsed.question.observation_id, actions: plan.actions.map(action => ({ ...action, target_id: action.target_id.slice(entry.prefix.length) })) }, entry.parsed.locator_map, signal);
    }
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
      if (signal.aborted) throw new DOMException("Execution cancelled.", "AbortError");
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

  async readTimer(signal: AbortSignal): Promise<number | null> {
    signal.throwIfAborted();
    return this.#readTimer();
  }

  async readState(signal: AbortSignal): Promise<PlatformState> {
    if (signal.aborted) throw new DOMException("State read cancelled.", "AbortError");
    if (this.#pageQuestions.length) {
      const states = await Promise.all(this.#pageQuestions.map(entry => entry.adapter.readState(signal)));
      const first = states[0]!;
      return {
        ...first,
        timer_remaining_seconds: this.#readTimer(),
        observation_id: this.#currentObservation!.observation_id,
        fingerprint: fnv1a(JSON.stringify(states.map(state => state.fingerprint))),
        selected_target_ids: states.flatMap((state, index) => state.selected_target_ids.map(id => `${this.#pageQuestions[index]!.prefix}${id}`)),
        field_values: Object.fromEntries(states.flatMap((state, index) => Object.entries(state.field_values).map(([id, value]) => [`${this.#pageQuestions[index]!.prefix}${id}`, value]))),
        completed: states.every(state => state.completed),
        has_next: false,
        has_session_submit: states.some(state => state.has_session_submit),
      };
    }
    const selectedTargetIds: string[] = [];
    const fieldValues: Record<string, string> = {};
    for (const [targetId, storedTarget] of this.#targets) {
      const target = this.#resolveLiveTarget(targetId, storedTarget).target;
      if (!target) continue;
      this.#targets.set(targetId, target);
      if (target.kind === "select_option") {
        if (target.element.value === target.value) selectedTargetIds.push(targetId);
      } else if (target.element.tagName === "INPUT") {
        const input = target.element as HTMLInputElement;
        if (["radio", "checkbox"].includes(input.type) && input.checked) {
          selectedTargetIds.push(targetId);
        } else if (!["radio", "checkbox"].includes(input.type)) {
          fieldValues[targetId] = input.value;
        }
      } else if (target.element.tagName === "TEXTAREA") {
        fieldValues[targetId] = (target.element as HTMLTextAreaElement).value;
      } else if (target.element.isContentEditable) {
        fieldValues[targetId] = target.element.textContent ?? "";
      } else {
        if (selectedChoice(target.element)) selectedTargetIds.push(targetId);
      }
    }

    const pageText = normalizedText(this.courseScope ? this.courseScope.textContent : collectContexts(this.#document).map((context) =>
      context.nodeType === Node.DOCUMENT_NODE
        ? (context as Document).body?.innerText || (context as Document).body?.textContent
        : context.textContent,
    ).join(" ")).slice(-4_000);
    const feedbackText = queryAllDeep<HTMLElement>(
      this.#document,
      "[role='alert'], [aria-live], .feedback, .answer-feedback, .result, [data-feedback]",
    )
      .filter(element => !this.courseScope || this.courseScope.contains(element))
      .map(elementText)
      .join(" ");
    const strongPageFeedback = pageText.match(
      /(?:your answer is (?:correct|incorrect)|回答(?:正确|错误)|答(?:对|错)了?)/i,
    )?.[0] ?? "";
    // H5P replaces Check after grading and disables the answer controls. The
    // detached Check node cannot supply its old parent; Next still binds this
    // visible question, rather than an unrelated editable form on the page.
    const boundH5pRoot = ['control_submit', 'control_next', 'control_submit_session']
      .map(id=>this.#targets.get(id)?.element.closest<HTMLElement>('.h5p-question'))
      .find(root=>root?.isConnected && !isExplicitlyHidden(root));
    const feedbackRoot = boundH5pRoot ?? this.#activeRoot();
    const localGrading = feedbackRoot && !isExplicitlyHidden(feedbackRoot)
      ? Array.from(feedbackRoot.querySelectorAll<HTMLElement>('.h5p-question-feedback.h5p-question-visible, .h5p-question-scorebar.h5p-question-visible'))
          .filter(element=>!isExplicitlyHidden(element))
          .map(element=>elementText(element.querySelector('.h5p-joubelui-score-bar-progress') ?? element)).join(' ')
      : '';
    // H5P announces the new grade immediately, while its animated scorebar can
    // still display the previous attempt. Only use the current question's live
    // grade while grading is visible; unrelated page announcements are excluded.
    const liveGrading = localGrading && feedbackRoot
      ? Array.from(feedbackRoot.querySelectorAll<HTMLElement>('.h5p-hidden-read[aria-live]'))
          .filter(element=>!isExplicitlyHidden(element)).map(elementText).join(' ')
      : '';
    const pointsPattern = /\byou got\s+(\d+)\s+(?:out\s+)?of\s+(\d+)\s+points?\b/i;
    const points = liveGrading.match(pointsPattern) ?? localGrading.match(pointsPattern);
    const pointFeedback: PlatformState['feedback'] = points && Number(points[2])>0 && Number(points[1])<=Number(points[2])
      ? Number(points[1])===Number(points[2]) ? 'correct' : Number(points[1])===0 ? 'incorrect' : 'partial'
      : null;
    const feedbackEvidence = `${feedbackText} ${strongPageFeedback} ${localGrading}`;
    const feedback = pointFeedback ?? (/\bcorrect\b|回答正确|答对/i.test(feedbackEvidence)
      ? "correct"
      : /\bincorrect\b|\bwrong\b|回答错误|答错/i.test(feedbackEvidence)
        ? "incorrect"
        : null);
    const editableAnswerTarget = [...this.#targets.entries()].some(([targetId, target]) => {
      if (targetId.startsWith("control_")) return false;
      return !isExplicitlyHidden(target.element) && supportedInput(target.element);
    });
    const pathname = this.#document.location?.pathname ?? "";
    const completedPath = /\/(?:completed?|results?)\/?$/i.test(pathname);
    const scoredMatches = [...pageText.matchAll(/you got\s+(\d+)\s+out of\s+(\d+)\s+points?/gi)];
    const resultScore = pageText.match(/\bresult\s*:\s*(\d+)\s+of\s+(\d+)\s+(\d+(?:\.\d+)?)\s*%/i);
    const validResultScore = resultScore && Number(resultScore[2]) > 0 &&
      Number(resultScore[1]) <= Number(resultScore[2]) && Number(resultScore[3]) <= 100 &&
      Math.abs(Number(resultScore[3]) - 100 * Number(resultScore[1]) / Number(resultScore[2])) <= 1;
    const gradedQuestionSet = queryAllDeep<HTMLElement>(this.#document, '.questionset')
      .some(element => !isExplicitlyHidden(element));
    const scoredResult = !gradedQuestionSet && (scoredMatches.length > 0 || Boolean(validResultScore)) && this.#fingerprintCurrentQuestion() === "missing";
    const finalScore = scoredMatches.at(-1);
    const visibleScore = this.#readVisibleScore() ??
      (validResultScore ? `${resultScore[1]}/${resultScore[2]}` : finalScore ? `${finalScore[1]}/${finalScore[2]}` : null);
    const position = this.#readQuestionPosition();
    const sessionSubmit = this.#findButton(SESSION_SUBMIT_PATTERN);
    // A standalone H5P result retains its question and ARIA choices after
    // grading. A calibrated root therefore need not disappear. Require a
    // visible local grade and a closed answer surface; QuestionSet navigation
    // and course surfaces keep their existing completion rules.
    const standaloneH5pResult = !this.courseScope && !gradedQuestionSet &&
      Boolean(feedbackRoot?.matches('.h5p-question')) && pointFeedback !== null &&
      !sessionSubmit && !this.#findButton(NEXT_PATTERN) &&
      !this.#findButton(SUBMIT_PATTERN) && !this.#findButton(RETRY_PATTERN) &&
      !Array.from(feedbackRoot!.querySelectorAll(SUPPORTED_CONTROL_SELECTOR))
        .some(element => !isExplicitlyHidden(element) && supportedInput(element));
    const personalSessionScore = this.#readPersonalSessionScore();
    return {
      observation_id: this.#currentObservation?.observation_id ?? "none",
      timer_remaining_seconds: this.#readTimer(),
      fingerprint: this.#fingerprintCurrentQuestion(),
      selected_target_ids: selectedTargetIds,
      field_values: fieldValues,
      feedback,
      ...(feedbackEvidence.trim() ? { feedback_text: feedbackEvidence.trim() } : {}),
      ...(personalSessionScore || visibleScore ? { visible_score: personalSessionScore ?? visibleScore! } : {}),
      can_retry:
        this.#findButton(RETRY_PATTERN) !== null ||
        (feedback === "incorrect" && editableAnswerTarget),
      has_next: this.#findButton(NEXT_PATTERN) !== null,
      has_session_submit: sessionSubmit !== null,
      at_last_question: position !== null && position.current >= position.total,
      completed:
        (!this.courseScope && completedPath) ||
        personalSessionScore !== null ||
        standaloneH5pResult ||
        scoredResult ||
        (!gradedQuestionSet && /quiz complete|test complete|interview complete|your results?|测验完成|测试完成|答题完成|已交卷/i.test(pageText)),
    };
  }

  resolveMediaSource(temporaryHandle: string): MediaSource | undefined {
    return this.#mediaSources.get(temporaryHandle) ?? this.#pageQuestions.map(entry => entry.adapter.resolveMediaSource(temporaryHandle)).find(Boolean);
  }

  async #observePage(roots: HTMLElement[], sessionId: string, signal: AbortSignal, mode: ObservationInputMode): Promise<PlatformObservation> {
    const observationId = randomId("observation");
    const children = await Promise.all(roots.map(async (root, index) => {
      const adapter = new DomWebAdapter(this.#document, root, this.courseScope);
      const observation = await adapter.observeSession(sessionId, signal, mode);
      if (observation.layout !== "sequential") throw new Error("Question groups cannot be separated reliably.");
      return { adapter, observation, parsed: observation.questions[0]!, prefix: `page_${index + 1}_` };
    }));
    this.#pageQuestions = children;
    const globalSubmit = queryAllDeep<HTMLElement>(this.#document, "button, input[type='submit'], input[type='button'], [role='button']")
      .filter(element => !isExplicitlyHidden(element) && supportedInput(element) && !roots.some(root => root.contains(element)))
      .filter(element => SESSION_SUBMIT_PATTERN.test(targetText(this.#document, element)) || SUBMIT_PATTERN.test(targetText(this.#document, element)));
    if (globalSubmit.length === 1) {
      const first = children[0]!;
      first.parsed.locator_map.targets.control_submit_session = { kind: "semantic", local_ref: randomId("node"), role: "button" };
      first.adapter.#targets.set("control_submit_session", { kind: "element", element: globalSubmit[0]!, identity: { ...targetIdentity(this.#document, globalSubmit[0]!, "session_submit"), question_fingerprint: first.parsed.locator_map.question_fingerprint } });
    }
    const questions = children.map(({ parsed, prefix }) => ({
      question: { ...parsed.question, question_id: `${prefix}${parsed.question.question_id}`, observation_id: observationId, options: parsed.question.options.map(option => ({ ...option, id: `${prefix}${option.id}` })), blanks: parsed.question.blanks.map(blank => ({ ...blank, id: `${prefix}${blank.id}` })) },
      locator_map: { ...parsed.locator_map, question_id: `${prefix}${parsed.question.question_id}`, observation_id: observationId, targets: Object.fromEntries(Object.entries(parsed.locator_map.targets).map(([id, target]) => [`${prefix}${id}`, target])) },
    }));
    const first = children[0]!.observation;
    const observation: PlatformObservation = {
      ...first, observation_id: observationId, layout: "multi_question_page", questions, question_total: questions.length,
      fingerprint: fnv1a(JSON.stringify(children.map(child => child.observation.fingerprint))),
      local_control_candidates: [],
      ...(first.page_context ? { page_context: { ...first.page_context, controls: children.flatMap(child => child.observation.page_context?.controls.map(control => ({ ...control, semantic_id: `${child.prefix}${control.semantic_id}` })) ?? []).slice(0, 256) } } : {}),
    };
    this.#currentObservation = observation;
    this.#currentLocator = questions[0]!.locator_map;
    return observation;
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
      return choose([...choiceControls(root, 'radio'), ...choiceControls(root, 'checkbox')]
        .filter((element) => !isExplicitlyHidden(element) && supportedInput(element)));
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
        ? [...queryAllDeep<HTMLElement>(this.#document, "button, input[type='submit'], input[type='button'], [role='button']")
            .filter((element) => element.matches("button.h5p-question-finish") || SESSION_SUBMIT_PATTERN.test(targetText(this.#document, element))),
          ...[resolveZhidaoPracticeSubmit(this.#document)].filter((e): e is HTMLElement=>e!==null)]
        : targetId === "control_next"
          ? queryAllDeep<HTMLElement>(this.#document, `button, input[type='submit'], input[type='button'], [role='button'], a.h5p-question-next, ${ZHIDAO_NEXT_SELECTOR}`)
              .filter((element) => NEXT_PATTERN.test(targetText(this.#document, element)))
          : targetId === "control_retry"
            ? queryAllDeep<HTMLElement>(this.#document, "button, input[type='submit'], input[type='button'], [role='button']")
                .filter((element) => RETRY_PATTERN.test(targetText(this.#document, element)))
            : [];
    return choose([...new Set(candidates)].filter((element) => (!this.courseScope || this.courseScope.contains(element)) && !isExplicitlyHidden(element) && supportedInput(element)));
  }

  #registerCandidateControls(locatorMap: LocatorMap): NonNullable<PlatformObservation["local_control_candidates"]> {
    const knownElements = new Map<HTMLElement, string>();
    for (const [semanticId, target] of this.#targets) knownElements.set(target.element, semanticId);
    const candidates = queryAllDeep<HTMLElement>(
      this.#document,
      "button, input[type='submit'], input[type='button'], [role='button'], a[href]",
    ).filter((element) => (!this.courseScope || this.courseScope.contains(element)) && !isExplicitlyHidden(element) && supportedInput(element));

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
      const selected = selectedChoice(element);
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

    const body = this.courseScope ?? this.#document.body;
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
    const radioControls = choiceControls(root, 'radio');
    const checkboxControls = choiceControls(root, 'checkbox');
    const select = root.querySelector<HTMLSelectElement>("select:not([multiple])");
    const textControls = Array.from(
      root.querySelectorAll<HTMLElement>("input[type='text'], input[type='number'], input:not([type]), textarea, [contenteditable='true']"),
    ).filter((element) => !isExplicitlyHidden(element) && (supportedInput(element) || hasVisibleQuestionSetGrade(root)));

    const optionControls = radioControls.length > 0 ? radioControls : checkboxControls;
    const type: QuestionFrame["type"] =
      radioControls.length > 0 || select
        ? "single_choice"
        : checkboxControls.length > 0
          ? "multiple_choice"
          : "fill_blank";
    const stemText = type === "fill_blank" ? blankQuestionStem(root, textControls, stem.text) : stem.text;
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
    let submit = nativeSubmit && !NEXT_PATTERN.test(targetText(ownerDocument, nativeSubmit))
      ? nativeSubmit
      : this.#findButton(SUBMIT_PATTERN, root);
    // A newly visible H5P Finish is a session control even after Check disappears.
    if (submit?.matches('button.h5p-question-finish')) submit = null;
    if (!submit && !this.rootOverride && !this.courseScope && candidateRoots(this.#document).length === 1) {
      const container = root.closest("form, main, [role='main'], [data-vv-quiz], .quiz") ?? root.parentElement;
      const questionForm = root.closest("form");
      const external = queryAllDeep<HTMLElement>(this.#document, "button, input[type='submit'], input[type='button'], [role='button']")
        .filter(element => container?.contains(element) && !root.contains(element) &&
          !element.closest("header, nav, aside, footer, [role='search']") && element.closest("form") === questionForm &&
          !isExplicitlyHidden(element) && supportedInput(element) &&
          SUBMIT_PATTERN.test(targetText(ownerDocument, element)));
      if (external.length === 1) submit = external[0]!;
    }
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
    const retry = this.#findButton(RETRY_PATTERN, root) ??
      root.querySelector<HTMLElement>("button.h5p-question-try-again") ??
      this.#findButton(RETRY_PATTERN);
    if (retry) {
      const localRef = randomId("node");
      targets.control_retry = { kind: "semantic", local_ref: localRef, role: "button" };
      this.#targets.set("control_retry", { kind: "element", element: retry, identity: targetIdentity(ownerDocument, retry, "retry") });
    }
    const sessionSubmit = this.#findButton(SESSION_SUBMIT_PATTERN, this.#document, true);
    if (sessionSubmit && (this.courseScope || !root.contains(sessionSubmit) || sessionSubmit.matches("button.h5p-question-finish")) && sessionSubmit !== submit) {
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
    if (!supportedInput(target.element)) throw new Error("Target is disabled.");
    if (target.kind === "select_option") {
      if (value && target.element.value !== target.value) {
        target.element.value = target.value;
        dispatchValueEvents(target.element);
      }
      return;
    }
    const element = target.element;
    if (isZhidaoChoice(element)) {
      // This is a radio widget: selecting the desired option clears its peer.
      // Do not click an already selected peer to "clear" it before that click.
      if (value && !zhidaoSelected(element)) element.click();
      return;
    }
    if (element.tagName === "INPUT" && ["radio", "checkbox"].includes((element as HTMLInputElement).type)) {
      const input = element as HTMLInputElement;
      if (input.disabled) throw new Error("Target is disabled.");
      if (input.checked !== value) input.click();
      return;
    }
    const current = selectedChoice(element);
    if (current !== value) element.click();
  }

  #setValue(target: DomTarget, value: string): void {
    if (target.kind !== "element") throw new Error("Text target is invalid.");
    const element = target.element;
    if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
      const input = element as HTMLInputElement | HTMLTextAreaElement;
      if (input.disabled || input.readOnly) throw new Error("Target is not editable.");
      input.focus();
      input.value = value;
      dispatchValueEvents(input);
    } else if (element.isContentEditable) {
      element.focus();
      element.textContent = value;
      dispatchValueEvents(element);
    } else {
      throw new Error("Target is not a supported text field.");
    }
  }

  #findButton(pattern: RegExp, within: ParentNode = this.#document, includeDisabled = false): HTMLElement | null {
    if(pattern===SESSION_SUBMIT_PATTERN){
      const practiceSubmit=resolveZhidaoPracticeSubmit(this.#document);
      if(practiceSubmit && (within===this.#document || within.contains(practiceSubmit)) &&
        (!this.courseScope || this.courseScope.contains(practiceSubmit)))return practiceSubmit;
    }
    const selector = "button, input[type='submit'], input[type='button'], [role='button'], a.h5p-question-next" +
      (pattern === NEXT_PATTERN ? `, ${ZHIDAO_NEXT_SELECTOR}` : '');
    const candidates =
      within === this.#document
        ? queryAllDeep<HTMLElement>(this.#document, selector)
        : Array.from(within.querySelectorAll<HTMLElement>(selector));
    return (
      candidates
        .filter((element) => (!this.courseScope || this.courseScope.contains(element)) && !isExplicitlyHidden(element) && (includeDisabled || supportedInput(element)))
        .find((element) =>
          (pattern === SUBMIT_PATTERN && element.matches("button.h5p-question-check-answer")) ||
          (pattern === SESSION_SUBMIT_PATTERN && element.matches("button.h5p-question-finish")) ||
          (pattern === RETRY_PATTERN && element.matches("button.h5p-question-try-again")) ||
          pattern.test(normalizedText(
            element.tagName === "INPUT" ? (element as HTMLInputElement).value : element.getAttribute("aria-label") || element.textContent,
          )),
        ) ?? null
    );
  }

  #fingerprintCurrentQuestion(): string {
    const root = this.#activeRoot();
    if (!root) {
      const next = this.#targets.get("control_next") ?? this.#targets.get("control_submit_session");
      const current = next?.element.closest<HTMLElement>(".h5p-question");
      const graded = current?.querySelector<HTMLElement>(
        ".h5p-question-feedback.h5p-question-visible, .h5p-question-scorebar.h5p-question-visible",
      );
      if (
        next?.kind === "element" && next.element.matches("a.h5p-question-next, button.h5p-question-finish") &&
        current && graded && !isExplicitlyHidden(current) && !isExplicitlyHidden(graded) &&
        !isExplicitlyHidden(next.element) && this.#currentLocator?.question_fingerprint
      ) {
        return this.#currentLocator.question_fingerprint;
      }
      return "missing";
    }
    const baseStem = semanticStem(root.ownerDocument, root).text;
    const radioControls = choiceControls(root, 'radio');
    const checkboxControls = choiceControls(root, 'checkbox');
    const select = root.querySelector<HTMLSelectElement>("select:not([multiple])");
    const type = radioControls.length > 0 || select
      ? "single_choice"
      : checkboxControls.length > 0
        ? "multiple_choice"
        : "fill_blank";
    const textControls = type === "fill_blank"
      ? Array.from(root.querySelectorAll<HTMLElement>("input[type='text'], input[type='number'], input:not([type]), textarea, [contenteditable='true']"))
          .filter((element) => !isExplicitlyHidden(element) && (supportedInput(element) || hasVisibleQuestionSetGrade(root)))
      : [];
    const stem = type === "fill_blank" ? blankQuestionStem(root, textControls, baseStem) : baseStem;
    const options = select
      ? Array.from(select.options)
          .filter((option) => !option.disabled && option.value !== "")
          .map((option) => normalizedText(option.text))
      : (radioControls.length > 0 ? radioControls : checkboxControls)
          .map((element, index) => optionLabel(root.ownerDocument, element) || `Option ${index + 1}`);
    const blanks = textControls.length;
    return fnv1a(JSON.stringify({ type, stemText: stem, options, blanks }));
  }

  #readTimer(): number | null {
    const timers = queryAllDeep<HTMLElement>(
      this.#document,
      "[data-remaining-seconds], [role='timer'], .timer, .countdown",
    );
    for (const timer of timers) {
      if (this.courseScope && !this.courseScope.contains(timer)) continue;
      if (isExplicitlyHidden(timer)) continue;
      if (timer.getAttribute('data-timer-scope') === 'question' || timer.getAttribute('data-timer-scope') === 'page') continue;
      const explicit = timer.getAttribute("data-remaining-seconds");
      if (explicit && /^\d+$/.test(explicit)) return Number(explicit);
      const text = elementText(timer);
      const meaning = [text, timer.getAttribute('aria-label'), timer.getAttribute('title')].filter(Boolean).join(' ');
      // A timer role or generic class can also describe elapsed time. Unknown
      // clocks must not trigger the session deadline or submission.
      if (/elapsed|time\s+(?:spent|taken)|已用|已耗|用时/i.test(meaning)) continue;
      if (!timer.classList.contains('countdown') && !/remaining|time\s+(?:left|to\s+(?:finish|complete))|countdown|剩余|倒计时/i.test(meaning)) continue;
      if (/(?:question|page)\s+(?:time|countdown)|time\s+left\s+(?:for|on)\s+(?:this\s+)?(?:question|page)|本题|每题|本页/i.test(meaning)) continue;
      const match = text.match(/(?:(\d+):)?(\d{1,2}):(\d{2})/);
      if (!match || Number(match[3]) >= 60 || (match[1] && Number(match[2]) >= 60)) continue;
      return Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    }
    return null;
  }

  #readQuestionTotal(): number | null {
    const zhidaoProgress = readZhidaoPractice(this.#document);
    if (zhidaoProgress) return zhidaoProgress.total;
    const h5pProgress = this.#readH5pProgress();
    if (h5pProgress) return h5pProgress.total;
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
    const zhidaoProgress = readZhidaoPractice(this.#document);
    if (zhidaoProgress) return { current: zhidaoProgress.current, total: zhidaoProgress.total };
    const h5pProgress = this.#readH5pProgress();
    if (h5pProgress) return h5pProgress;
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

  #readH5pProgress(): { current: number; total: number } | null {
    const dots = queryAllDeep<HTMLElement>(this.#document, '.questionset .progress-dot, .questionset .h5p-progress-dot')
      .filter(element => !isExplicitlyHidden(element));
    const current = dots.filter(element => element.classList.contains('current'));
    if (current.length !== 1) return null;
    const parse = (element: HTMLElement) => element.getAttribute('aria-label')?.match(/^(?:Question|题目)\s*(\d+)\s*(?:of|\/|共)\s*(\d+)(?:\s*[,，]|$)/i);
    const active = parse(current[0]!);
    if (!active) return null;
    const total=Number(active[2]), position=Number(active[1]);
    const labels=dots.map(parse);
    if(total!==dots.length || position<1 || position>total || labels.some(label=>!label || Number(label[2])!==total) ||
      new Set(labels.map(label=>Number(label![1]))).size!==total || labels.some(label=>Number(label![1])<1 || Number(label![1])>total)) return null;
    return { current:position,total };
  }

  #readVisibleScore(): string | null {
    const score = queryAllDeep<HTMLElement>(this.#document, "[data-score], .score, .quiz-score, .grade")
      .filter(element => (!this.courseScope || this.courseScope.contains(element)) && !isExplicitlyHidden(element))
      .map((element) => element.getAttribute("data-score") || elementText(element))
      .find(Boolean);
    return score ? normalizedText(score) : null;
  }

  #readPersonalSessionScore(): string | null {
    if (this.courseScope) return null;
    // A review page may retain every question. Require a local, visible personal
    // score and a closed answering surface, rather than a page-wide number match.
    if (this.#findButton(SESSION_SUBMIT_PATTERN) || this.#findButton(NEXT_PATTERN) ||
      queryAllDeep<HTMLElement>(this.#document, SUPPORTED_CONTROL_SELECTOR)
        .some(element => !isExplicitlyHidden(element) && supportedInput(element))) return null;
    const captions = queryAllDeep<HTMLElement>(this.#document, "p, span, div, h1, h2, h3, h4, dt, figcaption")
      .filter(element => !isExplicitlyHidden(element) &&
        /^your (?:final )?score(?: for (?:today['’]s|this|the) (?:quiz|test|assessment))?\s*:?$/i.test(elementText(element)));
    for (const caption of captions) {
      let region = caption.parentElement;
      for (let depth = 0; region && depth < 3; depth++, region = region.parentElement) {
        if (elementText(region).length > 300) break;
        const scores = Array.from(region.querySelectorAll<HTMLElement>("div, span, p, strong, b, output, dd, h1, h2, h3"))
          .filter(element => !isExplicitlyHidden(element))
          .map(element => elementText(element).match(/^(\d+)\s*\/\s*(\d+)$/))
          .filter(match => match && Number(match[2]) > 0 && Number(match[1]) <= Number(match[2]))
          .map(match => `${match![1]}/${match![2]}`);
        const unique = [...new Set(scores)];
        if (unique.length === 1) return unique[0]!;
        if (unique.length > 1) break;
      }
    }
    return null;
  }
}
