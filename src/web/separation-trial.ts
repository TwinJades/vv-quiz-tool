import { elementText, fnv1a, isExplicitlyHidden, normalizedText } from "./dom-utils";

export interface SeparationCandidate {
  semantic_id: string;
  kind: "region" | "option";
  text: string;
  input_name?: string;
  input_value?: string;
}

export interface SeparationSnapshot {
  visible_text: string;
  candidates: SeparationCandidate[];
}

export interface SeparationRoles {
  region_id: string;
  option_ids: string[];
}

export interface SeparatedQuestion {
  stem: string;
  options: Array<{ semantic_id: string; text: string }>;
}

interface Region {
  element: HTMLElement;
  options: HTMLInputElement[];
  fingerprint: string;
}

function regionStem(element: HTMLElement): string {
  const copy = element.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("label, input, button, select, textarea").forEach((node) => node.remove());
  return normalizedText(copy.textContent);
}

export function cleanedVisibleText(document: Document, root = document.body, limit = 8_000): string {
  if (!root) return "";
  const parts: string[] = [];
  let length = 0;
  const hidden = new WeakMap<Element, boolean>();
  const excluded = (element: Element | null): boolean => {
    if (!element) return false;
    const cached = hidden.get(element);
    if (cached !== undefined) return cached;
    const value = element.matches("script, style, noscript, template, nav, header, aside, video, input[type='password']") ||
      isExplicitlyHidden(element) || excluded(element.parentElement);
    hidden.set(element, value);
    return value;
  };
  const walker = document.createTreeWalker(root, 4);
  for (let node = walker.nextNode(); node && length < limit; node = walker.nextNode()) {
    if (!excluded(node.parentElement)) {
      const text = node.textContent ?? "";
      parts.push(text);
      length += text.length + 1;
    }
  }
  return normalizedText(parts.join(" ")).slice(0, limit);
}

export interface LocalStructure {
  origin: string;
  tag: string;
  classes: string;
  input_type: string;
  input_name: string;
  option_count: number;
}

// An isolated calibration trial: no model-supplied selector or action reaches the DOM.
export class SeparationTrial {
  readonly #regions = new Map<string, Region>();
  readonly #options = new Map<string, HTMLInputElement>();
  readonly #document: Document;
  #structure: LocalStructure | null = null;

  constructor(document: Document, structure: LocalStructure | null = null) {
    this.#document = document;
    this.#structure = structure;
  }

  capture(): SeparationSnapshot {
    this.#regions.clear();
    this.#options.clear();
    const candidates: SeparationCandidate[] = [];
    const controls = Array.from(this.#document.querySelectorAll<HTMLInputElement>("input[type='radio'], input[type='checkbox']"))
      .filter((input) => !isExplicitlyHidden(input) && !input.disabled && !input.closest("header, nav, aside, [role='search']"));
    const groups = new Map<string, HTMLInputElement[]>();
    for (const input of controls) {
      const key = `${input.type}:${input.name || input.closest("form")?.id || "unnamed"}`;
      groups.set(key, [...(groups.get(key) ?? []), input]);
    }
    let regionNumber = 0;
    for (const group of groups.values()) {
      if (group.length < 2 || group.length > 16) continue;
      let root: HTMLElement = group[0]!.parentElement!;
      while (root.parentElement && !group.every((input) => root.contains(input))) root = root.parentElement;
      if (root === this.#document.body || root.closest("header, nav, aside, [role='search']")) continue;
      // Widen a label-only common parent to include the nearby question stem.
      if (!/[?？]|question|题/i.test(elementText(root)) && root.parentElement && root.parentElement !== this.#document.body) {
        root = root.parentElement;
      }
      const regionId = `region_${++regionNumber}`;
      const fingerprint = fnv1a(`${elementText(root)}|${group.map((input) => `${input.name}:${input.value}`).join("|")}`);
      this.#regions.set(regionId, { element: root, options: group, fingerprint });
      candidates.push({ semantic_id: regionId, kind: "region", text: elementText(root).slice(0, 2_000) });
      group.forEach((input, index) => {
        const id = `${regionId}_option_${index + 1}`;
        this.#options.set(id, input);
        candidates.push({ semantic_id: id, kind: "option", text: elementText(input.closest("label") ?? input.parentElement).slice(0, 300), input_name: input.name, input_value: input.value });
      });
    }
    return { visible_text: cleanedVisibleText(this.#document), candidates };
  }

  candidateStems(): string[] {
    return [...this.#regions.values()].map(({ element }) => regionStem(element)).filter(Boolean);
  }

  validate(roles: SeparationRoles): HTMLElement | null {
    const region = this.#regions.get(roles.region_id);
    if (!region || !region.element.isConnected || roles.option_ids.length !== region.options.length) return null;
    if (new Set(roles.option_ids).size !== roles.option_ids.length) return null;
    const chosen = roles.option_ids.map((id) => this.#options.get(id));
    if (chosen.some((input) => !input || !input.isConnected || !region.element.contains(input))) return null;
    if (!region.options.every((input, index) => chosen[index] === input)) return null;
    if (new Set(region.options.map((input) => input.name)).size !== 1) return null;
    const current = fnv1a(`${elementText(region.element)}|${region.options.map((input) => `${input.name}:${input.value}`).join("|")}`);
    return current === region.fingerprint ? region.element : null;
  }

  separate(roles: SeparationRoles): SeparatedQuestion | null {
    const element = this.validate(roles);
    if (!element) return null;
    const stem = regionStem(element);
    const options = roles.option_ids.map((semantic_id) => {
      const input = this.#options.get(semantic_id)!;
      const label = input.closest("label") ?? (input.id ? this.#document.querySelector(`label[for='${CSS.escape(input.id)}']`) : null);
      return { semantic_id, text: normalizedText(label?.textContent) };
    });
    if (!stem || options.some((option) => !option.text)) return null;
    return { stem, options };
  }

  remember(roles: SeparationRoles): boolean {
    const separated = this.separate(roles);
    const element = separated ? this.validate(roles) : null;
    const region = this.#regions.get(roles.region_id);
    if (!element || !region) return false;
    this.#structure = {
      origin: this.#document.location.origin,
      tag: element.tagName,
      classes: [...element.classList].sort().join(" "),
      input_type: region.options[0]!.type,
      input_name: region.options[0]!.name,
      option_count: region.options.length,
    };
    return true;
  }

  structure(): LocalStructure | null {
    return this.#structure ? { ...this.#structure } : null;
  }

  reuse(): HTMLElement | null {
    if (!this.#structure || this.#structure.origin !== this.#document.location.origin) return null;
    // Rebuild the local candidate map; the visible text is never sent to a model here.
    this.capture();
    const matches = [...this.#regions.values()].filter(({ element, options }) =>
      element.tagName === this.#structure!.tag &&
      [...element.classList].sort().join(" ") === this.#structure!.classes &&
      options[0]?.type === this.#structure!.input_type &&
      options[0]?.name && options.every((input) => input.name === options[0]!.name) &&
      options.length === this.#structure!.option_count &&
      options.every((input) => input.isConnected && element.contains(input)) &&
      Boolean(regionStem(element)),
    );
    return matches.length === 1 ? matches[0]!.element : null;
  }
}
