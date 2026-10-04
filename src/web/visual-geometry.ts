import type { VisualGeometry } from "../core/visual";

export function captureVisualGeometry(document: Document, blocker: string | null): VisualGeometry {
  const view = document.defaultView!;
  const viewport = { width: view.innerWidth, height: view.innerHeight, dpr: view.devicePixelRatio,
    scale: view.visualViewport?.scale ?? 1, offset_x: view.visualViewport?.offsetLeft ?? 0, offset_y: view.visualViewport?.offsetTop ?? 0 };
  const visible = (element: Element) => { const style=view.getComputedStyle(element); return style.display!=="none"&&style.visibility!=="hidden"&&style.visibility!=="collapse"; };
  const candidates = Array.from(document.querySelectorAll("canvas")).filter(visible)
    .filter(element => { const rect = element.getBoundingClientRect(); return rect.width >= 40 && rect.height >= 40 && rect.x < viewport.width && rect.y < viewport.height && rect.right > 0 && rect.bottom > 0; });
  const canvasElement = candidates.length === 1 ? candidates[0] : undefined;
  const canvas = canvasElement?.getBoundingClientRect();
  const x = canvas ? Math.max(0, canvas.x) : 0;
  const y = canvas ? Math.max(0, canvas.y) : 0;
  // A diagram inside a clearly marked DOM question keeps semantic execution.
  // A standalone game canvas takes priority over unrelated settings/forms.
  const markedQuestion = Array.from(document.querySelectorAll("[data-vv-question],[data-question],[data-question-id],.h5p-question,.quiz-question,.question-card,fieldset,[role='radiogroup']"))
    .some(root => visible(root) && root.getBoundingClientRect().width>0 && root.getBoundingClientRect().height>0 &&
      Array.from(root.querySelectorAll("input,textarea,select,[role='radio'],[role='checkbox'],[contenteditable='true']")).some(visible));
  const canvasSurface = Boolean(canvas&&canvas.width*canvas.height>=40000&&!markedQuestion);
  // Cropping is deliberately narrower than choosing visual execution. Game
  // settings, DOM timers, images, frames or any other visible element keep the
  // whole viewport. Never infer isolation from model advice or a site name.
  const ignored = new Set(["SCRIPT", "STYLE", "LINK", "META", "TEMPLATE", "NOSCRIPT"]);
  const hidden = (element: Element): boolean => {
    for (let parent: Element | null = element; parent; parent = parent.parentElement) if (!visible(parent)) return true;
    return false;
  };
  const outsideElement = Array.from(document.body.querySelectorAll("*")).some(element =>
    !ignored.has(element.tagName) && !hidden(element) && element !== canvasElement &&
    !canvasElement?.contains(element) && !element.contains(canvasElement ?? null));
  const textNodes = document.createTreeWalker(document.body, 4);
  let outsideText = false;
  for (let node = textNodes.nextNode(); node; node = textNodes.nextNode()) {
    const parent = node.parentElement;
    if (!node.textContent?.trim() || !parent || hidden(parent) || canvasElement?.contains(parent)) continue;
    if (parent.closest("script,style,template,noscript")) continue;
    outsideText = true; break;
  }
  const ancestors: Element[] = [];
  for (let parent = canvasElement?.parentElement; parent; parent = parent.parentElement) ancestors.push(parent);
  const decoration = ancestors.some(element => {
    if (!["none", ""].includes(view.getComputedStyle(element).backgroundImage)) return true;
    return ["::before", "::after"].some(pseudo => {
      const content = view.getComputedStyle(element, pseudo).content;
      return !["none", "normal", "", '""', "''"].includes(content);
    });
  });
  const isolatedCanvas = Boolean(canvasSurface && canvas && canvas.x >= 0 && canvas.y >= 0 &&
    canvas.right <= viewport.width && canvas.bottom <= viewport.height && !outsideElement && !outsideText && !decoration);
  return { url: view.location.href, time_origin: view.performance.timeOrigin, viewport,
    scroll: { x: view.scrollX, y: view.scrollY },
    region: { x, y, width: canvas ? Math.min(viewport.width, canvas.right) - x : viewport.width,
      height: canvas ? Math.min(viewport.height, canvas.bottom) - y : viewport.height }, blocker,
    canvas_surface: canvasSurface, isolated_canvas: isolatedCanvas };
}
