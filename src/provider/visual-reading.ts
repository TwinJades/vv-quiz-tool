import { z } from "zod";
import { assertVisualReading, visualReadingSchema } from "../core/visual";
import type { VisualCapture, VisualReading } from "../core/visual";

const question = visualReadingSchema.shape.questions.element;
const normalizedPoint = question.shape.options.element.shape.point.describe('x and y BOTH use normalized_1000 over the entire supplied image, never pixels.');
export const visualRecognitionSchema = visualReadingSchema.extend({
  coordinate_space: z.literal("normalized_1000"),
  questions: z.array(question.extend({
    region: question.shape.region.describe('ALL FOUR fields x, y, width and height use normalized_1000, never pixels. Enclose the visible stem and ALL options or blanks. x+width and y+height cannot exceed 1000.'),
    min_selections: question.shape.min_selections.describe('Total minimum FINAL selected choices, unchanged after selection; 0 for fill_blank, 1 for single_choice.'),
    max_selections: question.shape.max_selections.describe('Total maximum FINAL selected choices, unchanged after selection; 0 for fill_blank, 1 for single_choice.'),
    options: z.array(question.shape.options.element.extend({ point: normalizedPoint })).max(64),
    blanks: z.array(question.shape.blanks.element.extend({ point: normalizedPoint })).max(32),
  })).max(50),
  controls: z.array(visualReadingSchema.shape.controls.element.extend({ point: normalizedPoint })).max(64),
}).strict();

// One declared coordinate convention for every model, converted using the
// actual cropped bitmap. Never guess units or silently clamp invalid targets.
export function decodeVisualReading(output: unknown, capture: VisualCapture): VisualReading {
  const { coordinate_space: _, ...reading } = visualRecognitionSchema.parse(output);
  const sx = capture.frame.width / 1000, sy = capture.frame.height / 1000;
  const point = (p: { x: number; y: number }) => ({ x: p.x * sx, y: p.y * sy });
  const label = (s: string) => s.replace(/\s+/g, " ").trim();
  const result: VisualReading = { ...reading,
    questions: reading.questions.map(q => ({ ...q, stem: label(q.stem),
      region: { ...point(q.region), width: q.region.width * sx, height: q.region.height * sy },
      options: q.options.map(option => ({ ...option, text: label(option.text), point: point(option.point) })),
      blanks: q.blanks.map(blank => ({ ...blank, text: label(blank.text), point: point(blank.point) })),
    })),
    controls: reading.controls.map(control => ({ ...control, point: point(control.point) })),
  };
  assertVisualReading(result, capture);
  return result;
}
