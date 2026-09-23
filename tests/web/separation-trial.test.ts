// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { DomWebAdapter } from "../../src/web/dom-adapter";
import { SeparationTrial } from "../../src/web/separation-trial";

describe("snapshot separation trial", () => {
  it("calibrates a structure the normal parser cannot separate, then rejects stale structure", async () => {
    document.body.innerHTML = `<main><section class="quiz-layout"><p>Which language is compiled?</p><div class="answers"><label><input type="radio" name="q" value="a"> C</label><label><input type="radio" name="q" value="b"> CSS</label></div></section><p style="display:none">private hidden text</p></main>`;
    const normal = await new DomWebAdapter(document).observeSession("s", new AbortController().signal);
    expect(normal.questions[0]!.question.stem.text).not.toContain("Which language is compiled?");
    const trial = new SeparationTrial(document);
    const snapshot = trial.capture();
    expect(snapshot.visible_text).toContain("Which language is compiled?");
    expect(snapshot.visible_text).not.toContain("private hidden text");
    const region = snapshot.candidates.find((candidate) => candidate.kind === "region")!;
    const options = snapshot.candidates.filter((candidate) => candidate.kind === "option");
    const roles = { region_id: region.semantic_id, option_ids: options.map((option) => option.semantic_id) };
    expect(trial.validate(roles)?.classList.contains("quiz-layout")).toBe(true);
    expect(trial.separate(roles)).toEqual({
      stem: "Which language is compiled?",
      options: [
        { semantic_id: options[0]!.semantic_id, text: "C" },
        { semantic_id: options[1]!.semantic_id, text: "CSS" },
      ],
    });
    expect(trial.validate({ region_id: region.semantic_id, option_ids: [options[0]!.semantic_id, "made_up"] })).toBeNull();
    document.querySelector("p")!.textContent = "Different question?";
    expect(trial.validate(roles)).toBeNull();
    expect(trial.separate(roles)).toBeNull();
  });

  it("reuses only a unique matching structure on the next question", () => {
    document.body.innerHTML = `<main><section class="quiz-layout"><p>First question?</p><div><label><input type="radio" name="q" value="a"> A</label><label><input type="radio" name="q" value="b"> B</label></div></section></main>`;
    const trial = new SeparationTrial(document);
    const snapshot = trial.capture();
    const roles = {
      region_id: snapshot.candidates.find((candidate) => candidate.kind === "region")!.semantic_id,
      option_ids: snapshot.candidates.filter((candidate) => candidate.kind === "option").map((candidate) => candidate.semantic_id),
    };
    expect(trial.remember(roles)).toBe(true);
    const structure = trial.structure();
    document.body.innerHTML = `<main><section class="quiz-layout"><p>Second question?</p><div><label><input type="radio" name="q2" value="x"> X</label><label><input type="radio" name="q2" value="y"> Y</label></div></section></main>`;
    expect(trial.reuse()?.textContent).toContain("Second question?");
    expect(new SeparationTrial(document, structure).reuse()?.textContent).toContain("Second question?");
    expect(new SeparationTrial(document, { ...structure!, origin: "https://other.example" }).reuse()).toBeNull();
    document.querySelector("section")!.className = "changed-layout";
    expect(trial.reuse()).toBeNull();
    document.querySelector("section")!.className = "quiz-layout";
    document.querySelector("main")!.insertAdjacentHTML("beforeend", `<section class="quiz-layout"><p>Third question?</p><div><label><input type="radio" name="q" value="a"> A</label><label><input type="radio" name="q" value="b"> B</label></div></section>`);
    expect(trial.reuse()).toBeNull();
  });

  it("ignores a connected previous question hidden by its parent", () => {
    document.body.innerHTML = `<main><div id="old"><section class="quiz-layout"><p>First question?</p><div><label><input type="radio" name="q"> A</label><label><input type="radio" name="q"> B</label></div></section></div></main>`;
    const trial = new SeparationTrial(document);
    const snapshot = trial.capture();
    const roles = {
      region_id: snapshot.candidates.find((candidate) => candidate.kind === "region")!.semantic_id,
      option_ids: snapshot.candidates.filter((candidate) => candidate.kind === "option").map((candidate) => candidate.semantic_id),
    };
    expect(trial.remember(roles)).toBe(true);
    document.querySelector("#old")!.setAttribute("style", "display:none");
    document.querySelector("main")!.insertAdjacentHTML("beforeend", `<div><section class="quiz-layout"><p>Second question?</p><div><label><input type="radio" name="q"> X</label><label><input type="radio" name="q"> Y</label></div></section></div>`);
    expect(trial.reuse()?.textContent).toContain("Second question?");
  });
});
