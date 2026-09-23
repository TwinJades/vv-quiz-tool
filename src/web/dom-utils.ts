export function isExplicitlyHidden(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (current.hasAttribute("hidden") || current.getAttribute("aria-hidden") === "true") return true;
    const style = current.getAttribute("style")?.toLowerCase() ?? "";
    if (/display\s*:\s*none|visibility\s*:\s*hidden/.test(style)) return true;
    try {
      const computed = current.ownerDocument.defaultView?.getComputedStyle(current);
      if (computed?.display === "none" || computed?.visibility === "hidden") return true;
    } catch {
      // Keep checking ancestors when computed style is unavailable.
    }
  }
  return false;
}

export function normalizedText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function elementText(element: Element | null): string {
  return normalizedText(element?.textContent);
}

export function labelText(document: Document, element: Element): string {
  const ariaLabel = normalizedText(element.getAttribute("aria-label"));
  if (ariaLabel) return ariaLabel;

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => elementText(document.getElementById(id)))
      .filter(Boolean)
      .join(" ");
    if (text) return text;
  }

  if (element instanceof HTMLInputElement && element.labels?.length) {
    const text = Array.from(element.labels).map(elementText).filter(Boolean).join(" ");
    if (text) return text;
  }

  const wrappingLabel = element.closest("label");
  if (wrappingLabel) return elementText(wrappingLabel);
  return "";
}

export function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function dispatchValueEvents(element: Element): void {
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}
