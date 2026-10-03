import { describe, expect, it } from "vitest";
import { decodeVisualReading, visualRecognitionSchema } from "../../src/provider/visual-reading";
import { capture, reading } from "../fixtures/visual";

describe("declared visual coordinates", () => {
  function normalized() {
    const r=reading();
    r.questions[0]!.region={x:0,y:0,width:1000,height:1000};
    r.questions[0]!.options[0]!.point={x:250,y:500};
    r.questions[0]!.options[1]!.point={x:750,y:500};
    return {...r,coordinate_space:"normalized_1000"};
  }
  it("scales both axes using actual image dimensions and removes line wrapping from identity labels", () => {
    const input=normalized();
    input.questions[0]!.stem="Choose\n  Alpha";
    input.questions[0]!.options[0]!.text="A. The\n amount of matter";
    const result=decodeVisualReading(input,capture());
    expect(result.questions[0]).toMatchObject({stem:"Choose Alpha",region:{x:0,y:0,width:600,height:360}});
    expect(result.questions[0]!.options[0]).toMatchObject({text:"A. The amount of matter",point:{x:150,y:180}});
    expect(result.questions[0]!.options[1]!.point).toEqual({x:450,y:180});
  });
  it("refuses undeclared units, out-of-image points and duplicate labels after wrapping normalization", () => {
    expect(()=>decodeVisualReading({...normalized(),coordinate_space:"pixels"},capture())).toThrow();
    const outside=normalized();outside.questions[0]!.options[0]!.point.x=1001;
    expect(()=>decodeVisualReading(outside,capture())).toThrow("VISUAL_UNCERTAIN");
    const duplicate=normalized();duplicate.questions[0]!.options[1]!.text="  Alpha\n";
    expect(()=>decodeVisualReading(duplicate,capture())).toThrow("ambiguous");
  });
  it("keeps inventory bounds when coordinate descriptions are added", () => {
    const input=normalized();
    expect(visualRecognitionSchema.safeParse({...input,questions:Array(51).fill(input.questions[0])}).success).toBe(false);
    const q=input.questions[0]!;
    expect(visualRecognitionSchema.safeParse({...input,questions:[{...q,options:Array(65).fill(q.options[0])}]}).success).toBe(false);
    const blank={text:'answer',point:{x:500,y:500},disabled:false,confidence:1,value:'',required:true,focused:false};
    expect(visualRecognitionSchema.safeParse({...input,questions:[{...q,blanks:Array(33).fill(blank)}]}).success).toBe(false);
    const control={text:'Submit',point:{x:500,y:500},disabled:false,confidence:1,role:'submit',question_index:0};
    expect(visualRecognitionSchema.safeParse({...input,controls:Array(65).fill(control)}).success).toBe(false);
  });
});
