import { z } from "zod";
import type { LocatorMap } from "./schema";

export interface VisualSessionMetrics {
  screenshots: number;
  recognitions: number;
  coordinate_attempts: number;
  coordinate_clicks: number;
  verification_reads: number;
  verification_failures: number;
  stale_frame_rejections: number;
}
export function emptyVisualMetrics(): VisualSessionMetrics {
  return { screenshots: 0, recognitions: 0, coordinate_attempts: 0, coordinate_clicks: 0,
    verification_reads: 0, verification_failures: 0, stale_frame_rejections: 0 };
}

const point = z.object({ x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative() }).strict();
export const visualRectSchema = point.extend({ width: z.number().finite().positive(), height: z.number().finite().positive() }).strict();
export type VisualRect = z.infer<typeof visualRectSchema>;
export interface VisualGeometry {
  url: string;
  time_origin: number;
  viewport: { width: number; height: number; dpr: number; scale: number; offset_x: number; offset_y: number };
  scroll: { x: number; y: number };
  region: VisualRect;
  blocker: string | null;
  canvas_surface?: boolean;
}
export interface VisualFrame {
  visual_frame_id: string;
  session_id: string;
  observation_id: string;
  surface_id: string;
  captured_at: number;
  geometry: VisualGeometry;
  zoom: number;
  width: number;
  height: number;
  fingerprint: string;
  temporary_handle: string;
  pixel_tiles?: { size: number; columns: number; rows: number; hashes: string[] };
  validated_regions?: VisualRect[];
}
export interface VisualCapture { frame: VisualFrame; data: Uint8Array }
const visualItem = z.object({
  text: z.string().trim().min(1),
  point,
  selected: z.boolean(),
  disabled: z.boolean(),
  confidence: z.number().min(0).max(1),
}).strict();
export const visualReadingSchema = z.object({
  status: z.enum(["questions", "completed", "uncertain", "unsupported"]),
  confidence: z.number().min(0).max(1),
  questions: z.array(z.object({
    type: z.enum(["single_choice", "multiple_choice", "fill_blank"]),
    stem: z.string().trim().min(1),
    region: visualRectSchema,
    options: z.array(visualItem).max(64),
    blanks: z.array(visualItem.omit({ selected: true }).extend({ value: z.string(), required: z.boolean(), focused: z.boolean() })).max(32),
    min_selections: z.number().int().nonnegative(),
    max_selections: z.number().int().nonnegative(),
  }).strict()).max(50),
  controls: z.array(visualItem.omit({ selected: true }).extend({
    role: z.enum(["submit", "session_submit", "next", "retry"]),
    question_index: z.number().int().nonnegative().nullable(),
  })).max(64),
  feedback: z.enum(["correct", "incorrect", "partial"]).nullable(),
  feedback_text: z.string(),
  visible_score: z.string().nullable(),
  question_total: z.number().int().positive().nullable(),
  timer_is_countdown: z.boolean().nullable().describe("True only for an explicitly identified remaining-time countdown; false for elapsed/count-up clocks, null when ambiguous."),
  timer_remaining_seconds: z.number().nonnegative().nullable().describe("Seconds left only when timer_is_countdown is true; otherwise null. A bare 0:00 clock is not evidence of an expired countdown."),
}).strict();
export type VisualReading = z.infer<typeof visualReadingSchema>;
// Session-local structural hints only. Never include previous answers, selected
// states, field values or coordinates in an independent screenshot reading.
export interface VisualRecognitionContext {
  previous_structure: Array<{
    type: VisualReading["questions"][number]["type"];
    stem: string;
    option_labels: string[];
    blank_labels: string[];
    min_selections: number;
    max_selections: number;
  }>;
}

export function insideRect(p: { x: number; y: number }, rect: VisualRect): boolean {
  return p.x >= rect.x && p.y >= rect.y && p.x < rect.x + rect.width && p.y < rect.y + rect.height;
}
export function assertVisualReading(reading: VisualReading, capture: VisualCapture): void {
  if (reading.confidence < 0.85 || !["questions", "completed"].includes(reading.status)) throw new Error("VISUAL_UNCERTAIN: the screenshot was not recognized reliably.");
  if (reading.status === "completed") {
    if (reading.questions.length || !reading.visible_score) throw new Error("VISUAL_UNCERTAIN: completion needs a final score and no active question.");
    return;
  }
  if (!reading.questions.length) throw new Error("VISUAL_UNCERTAIN: no supported question in screenshot.");
  const bounds = { x: 0, y: 0, width: capture.frame.width, height: capture.frame.height };
  for (const q of reading.questions) {
    if (!insideRect(q.region, bounds) || q.region.x + q.region.width > bounds.width || q.region.y + q.region.height > bounds.height) throw new Error("VISUAL_UNCERTAIN: question region exceeds the captured image.");
    if (q.min_selections > q.max_selections || (q.type === "single_choice" && (q.max_selections !== 1 || q.min_selections !== 1)) ||
      (q.type === "fill_blank" ? q.options.length > 0 || !q.blanks.length || q.max_selections !== 0 || q.min_selections !== 0 : !q.options.length || q.blanks.length > 0 || q.max_selections > q.options.length)) throw new Error("VISUAL_UNCERTAIN: inconsistent question type or selection limits.");
    const labels = [...q.options, ...q.blanks].map(item => item.text);
    if (new Set(labels).size !== labels.length) throw new Error("VISUAL_UNCERTAIN: ambiguous target labels.");
    for (const item of [...q.options, ...q.blanks]) {
      if (item.confidence < 0.85 || !insideRect(item.point, q.region)) throw new Error("VISUAL_UNCERTAIN: target is outside the question or uncertain.");
    }
  }
  for (const control of reading.controls) {
    if (control.confidence < 0.85 || !insideRect(control.point, bounds) || (control.question_index !== null && !reading.questions[control.question_index])) throw new Error("VISUAL_UNCERTAIN: invalid control target.");
  }
}

function sameProtectedPixels(original: VisualFrame, current: VisualFrame): boolean {
  if (original.fingerprint === current.fingerprint) return true;
  const regions = original.validated_regions, a = original.pixel_tiles, b = current.pixel_tiles;
  if (!regions?.length || !a || !b || a.size !== 16 || a.size !== b.size || a.columns !== b.columns || a.rows !== b.rows ||
    a.columns !== Math.ceil(original.width / a.size) || a.rows !== Math.ceil(original.height / a.size) ||
    a.hashes.length !== a.columns * a.rows || b.hashes.length !== a.hashes.length) return false;
  for (const region of regions) {
    if (!insideRect(region, { x:0, y:0, width:original.width, height:original.height }) ||
      region.width <= 0 || region.height <= 0 || region.x + region.width > original.width || region.y + region.height > original.height) return false;
    for (let y=Math.floor(region.y/a.size);y<Math.ceil((region.y+region.height)/a.size);y++) {
      for (let x=Math.floor(region.x/a.size);x<Math.ceil((region.x+region.width)/a.size);x++) {
        const index=y*a.columns+x;
        if (!/^[a-f0-9]{64}$/.test(a.hashes[index]??"") || a.hashes[index] !== b.hashes[index]) return false;
      }
    }
  }
  return true;
}

export async function fingerprintVisualTiles(pixels: Uint8ClampedArray | Uint8Array, width: number, height: number): Promise<NonNullable<VisualFrame["pixel_tiles"]> | undefined> {
  if(pixels.length !== width*height*4) return undefined;
  const size=16, columns=Math.ceil(width/size), rows=Math.ceil(height/size);
  const hashes=await Promise.all(Array.from({length:columns*rows},async(_,index)=>{
    const x=(index%columns)*size,y=Math.floor(index/columns)*size;
    const w=Math.min(size,width-x),h=Math.min(size,height-y),tile=new Uint8Array(w*h*4);
    for(let row=0;row<h;row++) tile.set(pixels.subarray(((y+row)*width+x)*4,((y+row)*width+x+w)*4),row*w*4);
    const hash=await crypto.subtle.digest("SHA-256",tile);
    return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,"0")).join("");
  }));
  return {size,columns,rows,hashes};
}

export function assertVisualFreshness(original: VisualFrame, current: VisualFrame, now = Date.now()): void {
  if (original.session_id !== current.session_id || original.surface_id !== current.surface_id ||
    JSON.stringify(original.geometry) !== JSON.stringify(current.geometry) || original.zoom !== current.zoom ||
    original.width !== current.width || original.height !== current.height || !sameProtectedPixels(original,current) ||
    now < original.captured_at || now - original.captured_at > 60_000) {
    throw new Error("PAGE_CHANGED: visual target expired or the screenshot, viewport, zoom, scroll or document changed.");
  }
}

export function visualTargetPoint(map: LocatorMap, targetId: string, frame: VisualFrame, allowedRegion: VisualRect) {
  const target = map.targets[targetId];
  if (map.session_id !== frame.session_id || map.observation_id !== frame.observation_id || !target || target.kind !== "coordinate" ||
    target.visual_frame_id !== frame.visual_frame_id || target.confidence < 0.85 || !target.expected_label.trim() || !insideRect(target.point, allowedRegion)) {
    throw new Error("TARGET_UNAVAILABLE: coordinate target does not belong to the current authorized visual region.");
  }
  const cssPoint = {
    x: frame.geometry.region.x + target.point.x * frame.geometry.region.width / frame.width,
    y: frame.geometry.region.y + target.point.y * frame.geometry.region.height / frame.height,
  };
  if (!insideRect(cssPoint, frame.geometry.region)) throw new Error("TARGET_UNAVAILABLE: point outside captured viewport region.");
  return cssPoint;
}
