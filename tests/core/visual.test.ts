import { describe, expect, it } from "vitest";
import { assertVisualFreshness, assertVisualReading, visualTargetPoint, fingerprintVisualTiles } from "../../src/core/visual";
import { capture, reading } from "../fixtures/visual";
describe("visual frame boundary", () => {
  it("allows changes outside the protected question and target, but rejects any changed tile that intersects them", async () => {
    const pixels=new Uint8Array(64*64*4).fill(255);
    const old=capture().frame;old.width=64;old.height=64;
    old.pixel_tiles=(await fingerprintVisualTiles(pixels,64,64))!;
    old.validated_regions=[{x:16,y:16,width:32,height:32}];
    const current=structuredClone(old);current.fingerprint="timer changed";
    pixels[0]=0;current.pixel_tiles=(await fingerprintVisualTiles(pixels,64,64))!;
    expect(()=>assertVisualFreshness(old,current)).not.toThrow();
    pixels[(20*64+20)*4]=0;current.pixel_tiles=(await fingerprintVisualTiles(pixels,64,64))!;
    expect(()=>assertVisualFreshness(old,current)).toThrow("PAGE_CHANGED");
    current.geometry.scroll.y++;
    expect(()=>assertVisualFreshness(old,current)).toThrow("PAGE_CHANGED");
  });
  it("does not accept scoped pixel comparisons with missing hashes, bad bounds or changed target tiles", async () => {
    const old=capture().frame;old.width=32;old.height=32;
    old.pixel_tiles=(await fingerprintVisualTiles(new Uint8Array(32*32*4),32,32))!;
    old.validated_regions=[{x:24,y:24,width:8,height:8}];
    const changed=structuredClone(old);changed.fingerprint="different";changed.pixel_tiles!.hashes[3]="a".repeat(64);
    expect(()=>assertVisualFreshness(old,changed)).toThrow("PAGE_CHANGED");
    delete changed.pixel_tiles;
    expect(()=>assertVisualFreshness(old,changed)).toThrow("PAGE_CHANGED");
    changed.pixel_tiles=structuredClone(old.pixel_tiles);old.validated_regions=[{x:32,y:0,width:1,height:1}];
    expect(()=>assertVisualFreshness(old,changed)).toThrow("PAGE_CHANGED");
  });
  it.each(["pixels", "scroll", "zoom", "size", "document", "surface", "session", "age"])("rejects changed %s before clicking", change => {
    const original = capture().frame;
    const current = structuredClone(original);
    if (change === "pixels") current.fingerprint = "changed";
    if (change === "scroll") current.geometry.scroll.y++;
    if (change === "zoom") current.zoom = 1.5;
    if (change === "size") current.geometry.viewport.width++;
    if (change === "document") current.geometry.time_origin++;
    if (change === "surface") current.surface_id = "tab_2";
    if (change === "session") current.session_id = "s2";
    if (change === "age") original.captured_at -= 61_000;
    expect(() => assertVisualFreshness(original, current)).toThrow("PAGE_CHANGED");
  });
  it("converts pixels to CSS positions using the actual capture dimensions", () => {
    const frame = capture().frame;
    const map = { schema_version: "1.0" as const, session_id: "s1", question_id: "q1", observation_id: "o1", platform: "web" as const,
      question_fingerprint: "qfp", targets: { a: { kind: "coordinate" as const, visual_frame_id: "frame", point: { x: 300, y: 180 }, expected_label: "Alpha", confidence: 1 } } };
    expect(visualTargetPoint(map, "a", frame, { x: 0, y: 0, width: 600, height: 360 })).toEqual({ x: 160, y: 110 });
    expect(() => visualTargetPoint(map, "a", frame, { x: 0, y: 0, width: 100, height: 100 })).toThrow("TARGET_UNAVAILABLE");
    expect(() => visualTargetPoint({ ...map, session_id: "other" }, "a", frame, { x: 0, y: 0, width: 600, height: 360 })).toThrow();
  });
  it("rejects unsupported, out-of-region and ambiguous recognition", () => {
    const valid = reading();
    assertVisualReading(valid, capture());
    valid.questions[0]!.options[0]!.point.x = 1000;
    expect(() => assertVisualReading(valid, capture())).toThrow("VISUAL_UNCERTAIN");
    const duplicate = reading(); duplicate.questions[0]!.options[1]!.text = "Alpha";
    expect(() => assertVisualReading(duplicate, capture())).toThrow("ambiguous");
    expect(() => assertVisualReading({ ...reading(), status: "completed", questions: [], visible_score: null }, capture())).toThrow("final score");
  });
});
