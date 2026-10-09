import { cleanedVisibleText } from './separation-trial';
import { isExplicitlyHidden, normalizedText, isElementType, isHtmlElement } from './dom-utils';
import type { SemanticElement, SemanticQuestion } from './initial-snapshot';

interface MappedQuestion {
  root: HTMLElement;
  type: SemanticQuestion['type'];
  stems: HTMLElement[];
  options: HTMLElement[];
  blanks: HTMLElement[];
  controls: Array<{ element: HTMLElement; role: SemanticQuestion['controls'][number]['role'] }>;
}

interface Template {
  tag: string;
  classes: string;
  type: SemanticQuestion['type'];
  stemPaths: number[][];
  optionPaths: number[][];
  blankPaths: number[][];
  controls: Array<{ path: number[]; role: SemanticQuestion['controls'][number]['role']; text: string; shape: string }>;
  optionShapes: string[];
  blankShapes: string[];
  instructions: string;
}

const mappings = new WeakMap<Document, Set<SemanticDomMapping>>();
const stateClass = /^(?:hide|hidden|active|on|focus|focused|disabled|is-(?:active|selected|checked|disabled)|(?:selected|checked|chosen|choose)(?:[-_].+)?)$/i;
const selectedClass = /^(?:active|on|is-selected|is-checked|(?:selected|checked|chosen|choose)(?:[-_].+)?)$/i;

function shape(element: HTMLElement): string {
  return `${element.tagName}:${[...element.classList].filter(value => !stateClass.test(value))
    .map(value => value.replace(/\d+/g, '#')).sort().join(' ')}:${element.getAttribute('role') ?? ''}:${element.getAttribute('type') ?? ''}`;
}

export function semanticSelected(element: HTMLElement): boolean {
  const input = element.matches('input[type=radio],input[type=checkbox]') ? element :
    element.querySelector<HTMLInputElement>('input[type=radio],input[type=checkbox]');
  if (input && isElementType(input,'input')) return input.checked;
  const explicitState = ['aria-checked', 'aria-selected', 'data-selected', 'data-checked']
    .map(name => element.getAttribute(name)).find(value => value === 'true' || value === 'false');
  if (explicitState !== undefined) return explicitState === 'true';
  if (element.hasAttribute('checked') || [...element.classList].some(value => selectedClass.test(value))) return true;
  return [...element.querySelectorAll<HTMLElement>('[aria-checked=true],[aria-selected=true],.selected,.checked,.is-selected,.is-checked,.radio-on,.checkbox-on')]
    .some(mark => {
      const rectangle = mark.getBoundingClientRect();
      const style = mark.ownerDocument.defaultView?.getComputedStyle(mark);
      return !isExplicitlyHidden(mark) && rectangle.width > 0 && rectangle.height > 0 && style?.opacity !== '0';
    });
}

function disabled(element: HTMLElement): boolean {
  return element.getAttribute('aria-disabled') === 'true' || element.hasAttribute('disabled') ||
    element.classList.contains('disabled') || element.classList.contains('is-disabled');
}

function controlText(element: HTMLElement): string {
  return normalizedText(element.getAttribute('aria-label') ||
    (isElementType(element,'input') ? element.value : cleanedVisibleText(element.ownerDocument, element, Number.MAX_SAFE_INTEGER)));
}

function directText(element:HTMLElement):string {
  if(isElementType(element,'img'))return element.alt;
  if(isElementType(element,'input')&&['button','submit','reset'].includes(element.type))return element.value;
  return normalizedText([...element.childNodes].filter(node=>node.nodeType===3).map(node=>node.textContent).join(' '));
}

function path(root: HTMLElement, element: HTMLElement): number[] {
  const result: number[] = [];
  let current = element;
  while (current !== root) {
    const parent = current.parentElement;
    if (!parent || !root.contains(parent)) throw new Error('SEMANTIC_UNCERTAIN: control is outside its question.');
    result.unshift([...parent.children].indexOf(current));
    current = parent;
  }
  return result;
}

function at(root: HTMLElement, indexes: number[]): HTMLElement | null {
  let element: Element = root;
  for (const index of indexes) {
    const child = element.children[index];
    if (!child) return null;
    element = child;
  }
  return isHtmlElement(element) ? element : null;
}

function instructions(question: MappedQuestion): string {
  const excluded = [...question.stems, ...question.options, ...question.blanks, ...question.controls.map(control => control.element)];
  const walker = question.root.ownerDocument.createTreeWalker(question.root, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement && !node.parentElement.closest('a,button') && !isExplicitlyHidden(node.parentElement) && !excluded.some(element => element.contains(node))) parts.push(node.textContent ?? '');
  }
  return normalizedText(parts.join(' ')).replace(/\d+/g, '#');
}

function valid(question: MappedQuestion): boolean {
  const { root, type, stems, options, blanks } = question;
  const nodes = [...stems, ...options, ...blanks, ...question.controls.map(control => control.element)];
  if (!root.isConnected || isExplicitlyHidden(root) || !stems.length || new Set(nodes).size !== nodes.length ||
    nodes.some(element => !element.isConnected || !root.contains(element) || isExplicitlyHidden(element))) return false;
  if (stems.some(stem => options.some(control => stem.contains(control) || control.contains(stem)) ||
    blanks.some(control => control.contains(stem)))) return false;
  if (type === 'fill_blank' ? options.length > 0 || !blanks.length : blanks.length > 0 || options.length < 2) return false;
  if (blanks.some(element => !element.matches('input[type=text],input[type=number],input:not([type]),textarea,[contenteditable=true]'))) return false;
  const labels = options.map((element, index) => cleanedVisibleText(element.ownerDocument, element, Number.MAX_SAFE_INTEGER) ||
    normalizedText(element.getAttribute('aria-label')) || (element.matches('img') || element.querySelector('img') ? `Option ${index + 1}` : ''));
  return labels.every(Boolean) && new Set(labels).size === labels.length;
}

export class SemanticDomMapping {
  element(id:string):HTMLElement {
    const captured=this.#nodes.get(id),element=captured?.element;
    if(!element?.isConnected||isExplicitlyHidden(element)||directText(element)!==captured!.text)throw new Error('PAGE_CHANGED: semantic element is unavailable or changed.');
    return element;
  }
  #nodes = new Map<string, { element: HTMLElement; text: string }>();
  #questions: MappedQuestion[] = [];
  #templates: Template[] = [];
  #structureChanged = false;
  #courseIds=new WeakMap<HTMLElement,string>();
  #courseCounter=0;

  constructor(private readonly document: Document) {}

  capture(root:HTMLElement|null=this.document.body,includeFrames=false): SemanticElement[] {
    this.#nodes.clear();
    const elements: SemanticElement[] = [];
    const visit = (element: HTMLElement, parentId: string | null) => {
      if (element.matches('script,style,noscript,template,input[type=password],input[type=hidden]') || isExplicitlyHidden(element)) return;
      if(elements.length>=6000)throw new Error('SEMANTIC_LIMIT: visible page exceeds 6000 elements.');
      let element_id:string;
      if(includeFrames){const old=this.#courseIds.get(element);element_id=old??`course_element_${++this.#courseCounter}`;if(!old)this.#courseIds.set(element,element_id);}
      else element_id=`element_${elements.length+1}`;
      const text = directText(element);
      const clickable=element.matches('a,button,label,input,select,textarea,[role=radio],[role=checkbox],[role=button],[contenteditable=true],[tabindex],[onclick]') ||
        element.ownerDocument.defaultView?.getComputedStyle(element).cursor === 'pointer';
      this.#nodes.set(element_id, { element, text });
      elements.push({ element_id, parent_id: parentId, tag: element.tagName.toLowerCase(), text,
        classes: [...element.classList], role: element.getAttribute('role'), input_type: element.getAttribute('type'),
        clickable, disabled: disabled(element), selected: clickable ? semanticSelected(element) : false });
      for (const child of element.children) if (isHtmlElement(child)) visit(child, element_id);
      if(includeFrames&&isElementType(element,'iframe')&&element.contentDocument?.body)visit(element.contentDocument.body,element_id);
    };
    if (root) visit(root, null);
    if(new TextEncoder().encode(JSON.stringify(elements)).length>300000)throw new Error('SEMANTIC_LIMIT: visible snapshot exceeds 300000 bytes.');
    return elements;
  }

  apply(readings: SemanticQuestion[]): HTMLElement[] | null {
    const resolve = (id: string) => {
      const node = this.#nodes.get(id);
      return node && node.element.isConnected && !isExplicitlyHidden(node.element) &&
        directText(node.element) === node.text ? node.element : null;
    };
    const questions: MappedQuestion[] = [];
    for (const reading of readings) {
      const root = resolve(reading.region_id);
      const stems = reading.stem_ids.map(resolve), options = reading.option_ids.map(resolve), blanks = reading.blank_ids.map(resolve);
      const controls = reading.controls.map(control => ({ element: resolve(control.element_id), role: control.role }));
      if (!root || [...stems, ...options, ...blanks, ...controls.map(control => control.element)].some(element => !element)) return null;
      const question = { root, type: reading.type, stems: stems as HTMLElement[], options: options as HTMLElement[], blanks: blanks as HTMLElement[],
        controls: controls as MappedQuestion['controls'] };
      if (!valid(question)) return null;
      questions.push(question);
    }
    if (!questions.length || questions.some(question => questions.some(other => other !== question &&
      (question.root.contains(other.root) || other.root.contains(question.root))))) return null;
    this.#questions = questions;
    this.#templates = questions.map(question => ({ tag: question.root.tagName, classes: shape(question.root), type: question.type,
      stemPaths: question.stems.map(element => path(question.root, element)), optionPaths: question.options.map(element => path(question.root, element)),
      blankPaths: question.blanks.map(element => path(question.root, element)),
      controls: question.controls.map(control => ({ path: path(question.root, control.element), role: control.role,
        text: controlText(control.element), shape: shape(control.element) })),
      optionShapes: question.options.map(shape), blankShapes: question.blanks.map(shape), instructions: instructions(question) }));
    const owners = mappings.get(this.document) ?? new Set<SemanticDomMapping>();
    owners.add(this); mappings.set(this.document, owners);
    this.#nodes.clear();
    return questions.map(question => question.root);
  }

  roots(): HTMLElement[] {
    const reused: MappedQuestion[] = [];
    this.#structureChanged = false;
    for (const template of this.#templates) {
      const roots = [...this.document.getElementsByTagName(template.tag)].filter((element): element is HTMLElement =>
        isHtmlElement(element) && !isExplicitlyHidden(element) && shape(element) === template.classes);
      for (const root of roots) {
        const stems = template.stemPaths.map(indexes => at(root, indexes)), options = template.optionPaths.map(indexes => at(root, indexes)),
          blanks = template.blankPaths.map(indexes => at(root, indexes));
        const controls: MappedQuestion['controls'] = [];
        for (const control of template.controls) {
          const element = at(root, control.path);
          if (element && shape(element) === control.shape && controlText(element) === control.text && !isExplicitlyHidden(element)) controls.push({ element, role: control.role });
          else this.#structureChanged = true;
        }
        if ([...stems, ...options, ...blanks].some(element => !element)) continue;
        const question = { root, type: template.type, stems: stems as HTMLElement[], options: options as HTMLElement[], blanks: blanks as HTMLElement[],
          controls };
        if (valid(question) && question.options.every((element, index) => shape(element) === template.optionShapes[index]) &&
          question.blanks.every((element, index) => shape(element) === template.blankShapes[index]) && instructions(question) === template.instructions) reused.push(question);
      }
    }
    this.#questions = [...new Map(reused.map(question => [question.root, question])).values()];
    return this.#questions.map(question => question.root);
  }

  question(root: HTMLElement): MappedQuestion | undefined { return this.#questions.find(question => question.root === root); }
  hasStructure(): boolean { return this.#templates.length > 0; }
  needsRecognition(): boolean { this.roots(); return this.hasStructure() && (this.#structureChanged || !this.#questions.length); }
  optionType(element: HTMLElement): SemanticQuestion['type'] | undefined {
    return this.#questions.find(question => question.options.includes(element))?.type;
  }
  optionLabel(element: HTMLElement): string | undefined {
    const question = this.#questions.find(question => question.options.includes(element));
    if (!question) return undefined;
    const alternative = element.matches('.h5p-answer') ? element.querySelector<HTMLElement>('.h5p-alternative-inner') : null;
    if (alternative) return cleanedVisibleText(this.document, alternative, Number.MAX_SAFE_INTEGER);
    return cleanedVisibleText(this.document, element, Number.MAX_SAFE_INTEGER) || normalizedText(element.getAttribute('aria-label')) ||
      `Option ${question.options.indexOf(element) + 1}`;
  }

  clear(): void {
    mappings.get(this.document)?.delete(this);
    this.#nodes.clear(); this.#questions = []; this.#templates = [];
  }
}

export function semanticRoots(document: Document): HTMLElement[] {
  return [...(mappings.get(document) ?? [])].flatMap(mapping => mapping.roots());
}

export function semanticQuestion(root: HTMLElement): MappedQuestion | undefined {
  for (const mapping of mappings.get(root.ownerDocument) ?? []) {
    const question = mapping.question(root);
    if (question) return question;
  }
  return undefined;
}

export function semanticOptionType(element: HTMLElement): SemanticQuestion['type'] | undefined {
  for (const mapping of mappings.get(element.ownerDocument) ?? []) {
    const type = mapping.optionType(element);
    if (type) return type;
  }
  return undefined;
}

export function semanticOptionLabel(element: HTMLElement): string | undefined {
  for (const mapping of mappings.get(element.ownerDocument) ?? []) {
    const label = mapping.optionLabel(element);
    if (label) return label;
  }
  return undefined;
}
