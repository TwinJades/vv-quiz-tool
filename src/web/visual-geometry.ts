import type { VisualGeometry } from "../core/visual";

export function captureVisualGeometry(document: Document, blocker: string | null): VisualGeometry {
  const view = document.defaultView!;
  const viewport = { width: view.innerWidth, height: view.innerHeight, dpr: view.devicePixelRatio,
    scale: view.visualViewport?.scale ?? 1, offset_x: view.visualViewport?.offsetLeft ?? 0, offset_y: view.visualViewport?.offsetTop ?? 0 };
  const visible = (element: Element) => { const style=view.getComputedStyle(element); return style.display!=="none"&&style.visibility!=="hidden"&&style.visibility!=="collapse"; };
  const candidates = Array.from(document.querySelectorAll("canvas")).filter(visible).map(canvas => canvas.getBoundingClientRect())
    .filter(rect => rect.width >= 40 && rect.height >= 40 && rect.x < viewport.width && rect.y < viewport.height && rect.right > 0 && rect.bottom > 0);
  const canvas = candidates.length === 1 ? candidates[0] : undefined;
  const x = canvas ? Math.max(0, canvas.x) : 0;
  const y = canvas ? Math.max(0, canvas.y) : 0;
  // A diagram inside a clearly marked DOM question keeps semantic execution.
  // A standalone game canvas takes priority over unrelated settings/forms.
  const markedQuestion = Array.from(document.querySelectorAll("[data-vv-question],[data-question],[data-question-id],.h5p-question,.quiz-question,.question-card,fieldset,[role='radiogroup']"))
    .some(root => visible(root) && root.getBoundingClientRect().width>0 && root.getBoundingClientRect().height>0 &&
      Array.from(root.querySelectorAll("input,textarea,select,[role='radio'],[role='checkbox'],[contenteditable='true']")).some(visible));
  return { url: view.location.href, time_origin: view.performance.timeOrigin, viewport,
    scroll: { x: view.scrollX, y: view.scrollY },
    region: { x, y, width: canvas ? Math.min(viewport.width, canvas.right) - x : viewport.width,
      height: canvas ? Math.min(viewport.height, canvas.bottom) - y : viewport.height }, blocker,
    canvas_surface: Boolean(canvas&&canvas.width*canvas.height>=40000&&!markedQuestion) };
}
