// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { buildAnswerExecutionPlan } from '../../src/core';
import type { AnswerResult } from '../../src/core';
import { DomWebAdapter } from '../../src/web/dom-adapter';
import { readZhidaoPractice, resolveZhidaoPracticeSubmit } from '../../src/web/zhidao-practice';

// Observed public structural classes only; fictional questions and answer
// handlers. No current student's answers or private route values are included.
function fixture(current=1) {
  const window=new Window({url:'https://studentexamcomh5.zhihuishu.com/studentReviewTestOrExam/4029457/1/1/2100038049123758080/local-fixture'});
  const document=window.document as unknown as Document;
  document.body.innerHTML=`<div class="exam-test"><div class="header-content"><span class="back">返回</span><span class="reviewDone">提交作业</span></div>
    <div class="questionContent"><div class="questionName"><div class="questionTitle">${current}. 判断题</div><div class="centent-pre"><pre class="preStyle">这是本地测试用的判断题。</pre></div></div>
      <ul class="radio-view"><li class="clearfix"><i class="checkIcon"></i><span class="letterSort">A.</span><div class="stem">对</div></li>
      <li class="clearfix"><i class="checkIcon"></i><span class="letterSort">B.</span><div class="stem">错</div></li></ul></div>
    <div class="pre-next"><span class="next-topic ${current===3?'noNext':'next-t'}">下一题</span></div></div>
    <div class="ETC-right"><div class="reviewS stu-sheet"><div class="sheet-title">答题卡</div><div class="el-tree">
      <div class="el-tree-node is-expanded"><div class="el-tree-node__content">知识点练习默认部分</div><div class="el-tree-node__children">
        ${[1,2,3].map(number=>`<div class="el-tree-node"><div class="el-tree-node__content"><span class="custom-tree-answer-normal no-answer"><span class="font-sec-style-node">${number}</span></span></div></div>`).join('')}
      </div></div></div></div></div>`;
  document.querySelectorAll('.radio-view > li').forEach(option=>option.addEventListener('click',()=>{
    document.querySelectorAll('.checkIcon').forEach(icon=>icon.classList.remove('checkedIcon'));
    option.querySelector('.checkIcon')!.classList.add('checkedIcon');
  }));
  return {document,adapter:new DomWebAdapter(document)};
}
const signal=()=>new AbortController().signal;
function multipleFixture(current = 1) {
  const f = fixture(current);
  f.document.querySelector('.questionTitle')!.textContent = `${current}. 多选题`;
  f.document.querySelector('.radio-view')!.outerHTML = `<div class="checkbox-views"><div><div role="group" aria-label="checkbox-group" class="el-checkbox-group checkbox-view">${['Alpha','Beta','Gamma','Delta'].map((text,index)=>`<label class="el-checkbox"><span class="el-checkbox__input"><span class="el-checkbox__inner"></span><input type="checkbox" aria-hidden="false" class="el-checkbox__original" value="local-${index}"></span><span class="el-checkbox__label"><span class="letterSort fl">${String.fromCharCode(65+index)}</span><pre class="preStyle fl">${text}</pre></span></label>`).join('')}</div></div></div>`;
  return f;
}
function planFor(observation:Awaited<ReturnType<DomWebAdapter['observeSession']>>) {
  const item=observation.questions[0]!;
  const answer:AnswerResult={schema_version:'1.0',session_id:observation.session_id,question_id:item.question.question_id,
    observation_id:observation.observation_id,answer_type:'single_choice',status:'answered',selected_option_ids:[item.question.options[1]!.id],
    blank_answers:[],confidence:1,warnings:[]};
  return {item,plan:buildAnswerExecutionPlan(item.question,answer,item.locator_map,'unattended')};
}

describe('observed Zhidao custom judgment layout',()=>{
  it('allows normal final submission with a current selection whose answer card updates only on leaving',async()=>{
    const f=fixture(3);
    const labels=f.document.querySelectorAll('.font-sec-style-node');
    for(const label of Array.from(labels).slice(0,2)){
      label.parentElement!.classList.remove('no-answer');label.parentElement!.classList.add('answer');
    }
    expect(resolveZhidaoPracticeSubmit(f.document)).toBeNull();
    f.document.querySelectorAll<HTMLElement>('.radio-view >li')[1]!.click();
    expect(resolveZhidaoPracticeSubmit(f.document)).toBe(f.document.querySelector('.reviewDone'));
    await f.adapter.observeSession('practice',signal());
    expect(await f.adapter.readState(signal())).toMatchObject({has_session_submit:true,completed:false});
    labels[0]!.parentElement!.classList.remove('answer');labels[0]!.parentElement!.classList.add('no-answer');
    expect(resolveZhidaoPracticeSubmit(f.document)).toBeNull();
  });
  it('identifies judgment options without native radio inputs and verifies actual chosen state',async()=>{
    const f=fixture();expect(f.document.querySelectorAll('input')).toHaveLength(0);
    const observed=await f.adapter.observeSession('practice',signal());
    expect(observed.questions[0]!.question).toMatchObject({type:'single_choice',options:[{text:'对'},{text:'错'}]});
    const {item,plan}=planFor(observed);
    expect(observed.question_total).toBe(3);expect(observed.questions).toHaveLength(1);
    expect(item.question.type).toBe('single_choice');expect(item.question.options.map(option=>option.text)).toEqual(['对','错']);
    expect(await f.adapter.execute(plan,item.locator_map,signal())).toMatchObject([{status:'succeeded'},{status:'succeeded'}]);
    const state=await f.adapter.readState(signal());
    expect(state.selected_target_ids).toContain(item.question.options[1]!.id);
    expect(state.completed).toBe(false);
  });
  it('rejects a stale answer after the displayed question number changes',async()=>{
    const f=fixture();const observed=await f.adapter.observeSession('practice',signal());const {item,plan}=planFor(observed);
    f.document.querySelector('.questionTitle')!.textContent='2. 判断题';
    await expect(f.adapter.execute(plan,item.locator_map,signal())).rejects.toThrow(/PAGE_CHANGED/);
    expect(f.document.querySelectorAll('.checkedIcon')).toHaveLength(0);
  });
  it('keeps the final question separate from completed submission',async()=>{
    const f=fixture(3);await f.adapter.observeSession('practice',signal());
    expect(readZhidaoPractice(f.document)).toMatchObject({current:3,total:3,submission:'unknown'});
    expect(await f.adapter.readState(signal())).toMatchObject({at_last_question:true,has_next:false,completed:false});
  });
  it('refuses duplicate or collapsed answer cards as a reliable total',()=>{
    const f=fixture();f.document.querySelector('.font-sec-style-node')!.textContent='2';expect(readZhidaoPractice(f.document)).toBeNull();
    f.document.querySelector('.font-sec-style-node')!.textContent='1';f.document.querySelector('.is-expanded')!.classList.remove('is-expanded');
    expect(readZhidaoPractice(f.document)).toBeNull();
  });
});

describe('observed Zhidao native multiple choice layout',()=>{
  it('executes and verifies several checkbox selections with a reliable question position',async()=>{
    const f=multipleFixture();
    const observed=await f.adapter.observeSession('practice',signal());
    const item=observed.questions[0]!;
    expect(observed.question_total).toBe(3);
    expect(item.question).toMatchObject({type:'multiple_choice',options:[{text:'Alpha'},{text:'Beta'},{text:'Gamma'},{text:'Delta'}]});
    expect(item.question.stem).not.toContain('Alpha');
    const answer:AnswerResult={schema_version:'1.0',session_id:observed.session_id,question_id:item.question.question_id,
      observation_id:observed.observation_id,answer_type:'multiple_choice',status:'answered',selected_option_ids:[item.question.options[0]!.id,item.question.options[2]!.id],blank_answers:[],confidence:1,warnings:[]};
    const plan=buildAnswerExecutionPlan(item.question,answer,item.locator_map,'unattended');
    expect((await f.adapter.execute(plan,item.locator_map,signal())).every(a=>a.status==='succeeded')).toBe(true);
    expect((await f.adapter.readState(signal())).selected_target_ids).toEqual(answer.selected_option_ids);
  });
  it('allows a selected current question with a lagging card only when all other questions were saved',()=>{
    const f=multipleFixture(3);
    const labels=f.document.querySelectorAll('.font-sec-style-node');
    for(const label of Array.from(labels).slice(0,2)){label.parentElement!.classList.replace('no-answer','answer');}
    expect(resolveZhidaoPracticeSubmit(f.document)).toBeNull();
    f.document.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked=true;
    expect(resolveZhidaoPracticeSubmit(f.document)).toBe(f.document.querySelector('.reviewDone'));
    labels[0]!.parentElement!.classList.replace('answer','no-answer');
    expect(resolveZhidaoPracticeSubmit(f.document)).toBeNull();
  });
  it('does not trust a malformed checkbox group or a hidden question as submission evidence',()=>{
    const f=multipleFixture();
    f.document.querySelector('.letterSort')!.textContent='B';
    expect(readZhidaoPractice(f.document)).toBeNull();
    f.document.querySelector('.letterSort')!.textContent='A';
    f.document.querySelector<HTMLElement>('.questionContent')!.style.display='none';
    expect(readZhidaoPractice(f.document)).toBeNull();
    expect(resolveZhidaoPracticeSubmit(f.document)).toBeNull();
  });
});

describe('observed Zhidao custom single choice layout',()=>{
  it('recognizes a judgment to single-choice transition and executes one of four choices',async()=>{
    const f=fixture(3);
    f.document.querySelector('.questionTitle')!.textContent='3. 单选题';
    f.document.querySelector('.radio-view')!.innerHTML=['Alpha','Beta','Gamma','Delta'].map((text,index)=>`<li class="clearfix"><i class="checkIcon"></i><span class="letterSort">${String.fromCharCode(65+index)}.</span><div class="stem">${text}</div></li>`).join('');
    f.document.querySelectorAll('.radio-view >li').forEach(option=>option.addEventListener('click',()=>{f.document.querySelectorAll('.checkIcon').forEach(i=>i.classList.remove('checkedIcon'));option.querySelector('.checkIcon')!.classList.add('checkedIcon');}));
    const observed=await f.adapter.observeSession('practice',signal());
    expect(readZhidaoPractice(f.document)).toMatchObject({current:3,total:3});
    expect(observed.questions[0]!.question.options.map(o=>o.text)).toEqual(['Alpha','Beta','Gamma','Delta']);
    const {item,plan}=planFor(observed);
    expect((await f.adapter.execute(plan,item.locator_map,signal())).every(a=>a.status==='succeeded')).toBe(true);
    expect((await f.adapter.readState(signal())).selected_target_ids).toEqual([item.question.options[1]!.id]);
  });
});
