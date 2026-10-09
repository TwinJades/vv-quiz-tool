export function isHtmlElement(element: Element): element is HTMLElement {
  return element.namespaceURI === 'http://www.w3.org/1999/xhtml';
}

export function isElementType<K extends keyof HTMLElementTagNameMap>(element: Element, tag: K): element is HTMLElementTagNameMap[K] {
  return isHtmlElement(element) && element.localName === tag;
}

export function isExplicitlyHidden(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    const renderedChaoxingList=current.matches('ul.Zy_ulTop.w-top') && current.ownerDocument.location.hostname==='mooc1.chaoxing.com' && current.ownerDocument.location.pathname==='/mooc-ans/work/doHomeWorkNew';
    if (current.hasAttribute("hidden") || current.getAttribute("aria-hidden") === "true" && !renderedChaoxingList) return true;
    const style = current.getAttribute("style")?.toLowerCase() ?? "";
    if (/display\s*:\s*none|visibility\s*:\s*hidden/.test(style)) return true;
    const computed = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (computed?.display === "none" || computed?.visibility === "hidden" || computed?.visibility === 'collapse' || computed?.opacity === '0') return true;
  }
  return false;
}

export function requireClickable(element:HTMLElement):void {
  if(!element.isConnected||isExplicitlyHidden(element))throw new Error('TARGET_UNAVAILABLE: element is hidden or detached.');
  element.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
  const rect=element.getBoundingClientRect(),doc=element.ownerDocument,view=doc.defaultView;
  if(!view||rect.width<=0||rect.height<=0)throw new Error('TARGET_UNAVAILABLE: element has no rendered rectangle.');
  const x=Math.max(0,Math.min(view.innerWidth-1,rect.x+rect.width/2)),y=Math.max(0,Math.min(view.innerHeight-1,rect.y+rect.height/2));
  const hit=doc.elementFromPoint(x,y);
  const label = isElementType(element,'input') ? element.closest('label') : null;
  if(!hit || !element.contains(hit) && !(label && label.contains(hit)))throw new Error('TARGET_UNAVAILABLE: element is covered.');
  if(view.getComputedStyle(element).pointerEvents==='none'&&!label)throw new Error('TARGET_UNAVAILABLE: element rejects pointer input.');
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

  if (isElementType(element,'input') && element.labels?.length) {
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
  const view=element.ownerDocument.defaultView;
  if(!view)throw new Error('TARGET_UNAVAILABLE: document has no active window.');
  element.dispatchEvent(new view.Event("input", { bubbles: true }));
  element.dispatchEvent(new view.Event("change", { bubbles: true }));
}
