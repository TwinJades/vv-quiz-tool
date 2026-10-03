import type { VisualCapture, VisualReading } from "../../src/core/visual";

export function capture(): VisualCapture {
  return { frame: { visual_frame_id: "frame", session_id: "s1", observation_id: "o1", surface_id: "tab_1", captured_at: Date.now(),
    geometry: { url: "https://quiz.example", time_origin: 1, viewport: { width: 800, height: 600, dpr: 2, scale: 1, offset_x: 0, offset_y: 0 },
      scroll: { x: 0, y: 200 }, region: { x: 10, y: 20, width: 300, height: 180 }, blocker: null }, zoom: 1.25,
    width: 600, height: 360, fingerprint: "pixels", temporary_handle: "media" }, data: new Uint8Array([1]) };
}
export function reading(): VisualReading {
  return { status: "questions", confidence: 1, questions: [{ type: "single_choice", stem: "Choose Alpha", region: { x: 0, y: 0, width: 600, height: 360 },
    options: [{ text: "Alpha", point: { x: 40, y: 60 }, selected: false, disabled: false, confidence: 1 },
      { text: "Beta", point: { x: 120, y: 60 }, selected: false, disabled: false, confidence: 1 }], blanks: [], min_selections: 1, max_selections: 1 }],
    controls: [{ text: "Submit quiz", role: "session_submit", question_index: null, point: { x: 220, y: 120 }, disabled: false, confidence: 1 }],
    feedback: null, feedback_text: "", visible_score: null, question_total: 1, timer_is_countdown: null, timer_remaining_seconds: null };
}
