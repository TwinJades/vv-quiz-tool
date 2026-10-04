// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { applyChaoxingPracticeAnswers, readChaoxingPractice, readChaoxingPracticeReview } from '../../src/web/chaoxing-practice';
function fixture(){
  const w=new Window({url:'https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew?courseId=11&knowledgeid=22'});
  w.document.body.innerHTML='<div class="TiMu newTiMu"><div class="Zy_TItle"><span>1</span> 【判断题】<span class="font-cxsecret">原始字形</span></div><div><ul class="Zy_ulTop w-top"><li class="before-after" qid="101" qtype="3" role="radio"><label class="before">A</label><a class="after">对</a></li><li class="before-after" qid="101" qtype="3" role="radio"><label class="before">B</label><a class="after">错</a></li></ul></div></div><div class="TiMu newTiMu"><div class="Zy_TItle">2 【多选题】题干</div><ul aria-hidden="true" class="Zy_ulTop w-top"><li class="before-after-checkbox" qid="102" qtype="1" role="checkbox"><label class="before">A</label><a class="after">选项1</a></li><li class="before-after-checkbox" qid="102" qtype="1" role="checkbox"><label class="before">B</label><a class="after">选项2</a></li></ul></div>';
  const controls=Array.from(w.document.querySelectorAll('li'));let clicks=0;
  for(const c of controls)c.addEventListener('click',()=>{clicks++;if(c.getAttribute('role')==='radio')for(const peer of controls.filter(e=>e.getAttribute('qid')===c.getAttribute('qid')))peer.setAttribute('aria-checked',String(peer===c));else c.setAttribute('aria-checked',String(c.getAttribute('aria-checked')!=='true'));});
  const doc=w.document as unknown as Document;
  return {w,doc,controls,clicks:()=>clicks,reading:()=>readChaoxingPractice(doc)!};
}
const answers=[{id:'101',letters:['A']},{id:'102',letters:['B']}];
describe('observed Chaoxing practice controls',()=>{
  it('reads rendered aria-hidden lists but excludes CSS-hidden alternatives',()=>{
    const f=fixture();expect(f.reading().questions).toHaveLength(2);expect(f.reading().visual_text_required).toBe(true);
    f.controls[3]!.style.display='none';expect(readChaoxingPractice(f.doc)).toBeNull();
  });
  it('fills through normal clicks and verifies every option without reading hidden saved answers',()=>{
    const f=fixture();const result=applyChaoxingPracticeAnswers(f.doc,f.reading(),answers,new AbortController().signal);
    expect(result.questions.map(q=>q.options.map(o=>o.selected))).toEqual([[true,false],[false,true]]);
    const used=f.clicks();applyChaoxingPracticeAnswers(f.doc,result,answers,new AbortController().signal);expect(f.clicks()).toBe(used);
  });
  it('rejects an invalid later answer before writing the first question',()=>{
    const f=fixture();expect(()=>applyChaoxingPracticeAnswers(f.doc,f.reading(),[{id:'101',letters:['A']},{id:'102',letters:['Z']}],new AbortController().signal)).toThrow(/实际选项/);expect(f.clicks()).toBe(0);
  });
  it('stops after user cancellation instead of continuing later controls',()=>{
    const f=fixture(),controller=new AbortController();f.controls[0]!.addEventListener('click',()=>controller.abort());
    expect(()=>applyChaoxingPracticeAnswers(f.doc,f.reading(),answers,controller.signal)).toThrow();expect(f.clicks()).toBe(1);
  });
  it('refuses a changed question or option instead of relocating by old letters',()=>{
    const f=fixture(),before=f.reading();f.controls[2]!.querySelector('a')!.textContent='换题';
    expect(()=>applyChaoxingPracticeAnswers(f.doc,before,answers,new AbortController().signal)).toThrow(/身份改变/);expect(f.clicks()).toBe(0);
  });
  it('stops an unacknowledged click and does not claim filling success',()=>{
    const f=fixture();const inert=f.controls[0]!.cloneNode(true);f.controls[0]!.replaceWith(inert);
    expect(()=>applyChaoxingPracticeAnswers(f.doc,f.reading(),answers,new AbortController().signal)).toThrow(/没有确认/);expect(f.clicks()).toBe(0);
  });
  it('requires an explicit reviewed route and grade instead of accepting pending or ambiguous results',()=>{
    const w=new Window({url:'https://mooc1.chaoxing.com/mooc-ans/work/selectWorkQuestionYiPiYue?courseId=11&knowledgeid=22'}),doc=w.document as unknown as Document;
    w.document.body.innerText='章节测验 已完成 当前课时 题量: 4 满分: 100.0 第1次作答 本次成绩100分';
    expect(readChaoxingPracticeReview(doc)).toMatchObject({attempt:1,score:100,maximum:100,submission_confirmed:true,passed:null});
    w.document.body.innerText+=' 第2次作答 本次成绩80分';expect(readChaoxingPracticeReview(doc)).toBeNull();
    w.document.body.innerText='章节测验 待完成 题量: 4 满分: 100.0 第1次作答 本次成绩100分';expect(readChaoxingPracticeReview(doc)).toBeNull();
  });
});
