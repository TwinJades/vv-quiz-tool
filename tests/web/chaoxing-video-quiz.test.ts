// @vitest-environment happy-dom
import {SCHEMA_VERSION} from '../../src/core';
import {describe,it,expect} from 'vitest';
import {findChaoxingVideoQuiz,chaoxingVideoQuizQuestions,chaoxingVideoQuizReady,chaoxingVideoQuizControl} from '../../src/web/chaoxing-video-quiz';
import {coursePopupIdentity} from '../../src/web/course-popup-identity';
import {readQuestionFeedback} from '../../src/web/dom-result';
import {DomWebAdapter} from '../../src/web/dom-adapter';

function fixture(type='单选题',control='<label><input type="radio" name="q" value="a">甲</label><label><input type="radio" name="q" value="b">乙</label>') {
  document.body.innerHTML=`<div><video id="v"></video><div class="ans-videoquiz"><div class="tkTopic"><div class="tkTopic_title">${type}</div><div class="tkItem" data-questionid="q1"><div class="tkItem_title">题干</div>${control}</div></div><button id="videoquiz-submit">提交</button><div class="feedback"></div></div></div>`;
  return {video:document.querySelector('video')!,root:document.querySelector<HTMLElement>('.ans-videoquiz')!};
}
describe('学习通视频弹题',()=>{
  it('唯一归属播放器并识别题目与操作控件',()=>{
    const {video,root}=fixture();
    expect(findChaoxingVideoQuiz(video)?.root).toBe(root);
    expect(chaoxingVideoQuizQuestions(root)).toHaveLength(1);
    expect(chaoxingVideoQuizReady(root)).toBe(true);
    expect(chaoxingVideoQuizControl(root,'submit')?.id).toBe('videoquiz-submit');
    root.insertAdjacentHTML('beforeend','<button data-video-quiz-submit>提交</button>');
    expect(()=>chaoxingVideoQuizControl(root,'submit')).toThrow();
  });
  it('同页播放器不会混用弹题',()=>{
    const {video,root}=fixture();
    const holder=document.createElement('div');holder.innerHTML='<video id="other"></video><div data-video-quiz-root><input type="radio"></div>';document.body.append(holder);
    expect(findChaoxingVideoQuiz(video)?.root).toBe(root);
    expect(findChaoxingVideoQuiz(holder.querySelector('video')!)?.root).not.toBe(root);
    root.dataset.videoId='other';expect(findChaoxingVideoQuiz(video)).toBeNull();
  });
  it('填空就绪排除隐藏和禁用控件',()=>{
    const {root}=fixture('填空题','<textarea disabled></textarea><input type="password">');
    expect(chaoxingVideoQuizReady(root)).toBe(false);
    root.querySelector('textarea')!.disabled=false;expect(chaoxingVideoQuizReady(root)).toBe(true);
  });
  it('指纹不含选填值反馈或播放时间，题目变化则改变',()=>{
    const {root}=fixture('填空题','<input type="text">');
    const id=coursePopupIdentity('task',root);
    root.querySelector('input')!.value='答案';root.querySelector('.feedback')!.textContent='回答正确';
    expect(coursePopupIdentity('task',root)).toBe(id);
    const replacement=root.cloneNode(true) as HTMLElement;root.replaceWith(replacement);
    expect(coursePopupIdentity('task',replacement)).toBe(id);
    replacement.querySelector('.tkItem_title')!.textContent='新题干';
    expect(coursePopupIdentity('task',replacement)).not.toBe(id);
  });
  it.each([['单选题','radio','single_choice'],['多选题','checkbox','multiple_choice'],['填空题','text','fill_blank']])('解析%s',async(title,input,type)=>{
    const {root}=fixture(title,`<label><input type="${input}" name="q" value="a">甲</label>`);
    const adapter=new DomWebAdapter(document,undefined,root);
    const result=await adapter.observeSession('s',new AbortController().signal);
    expect(result.questions[0]!.question.type).toBe(type);
    expect(result.questions[0]!.question.stem).toBeDefined();
  });
  it.each([['单选题','radio'],['多选题','checkbox'],['填空题','text']])('实际应用%s答案',async(title,input)=>{
    const {root}=fixture(title,`<label><input type="${input}" name="q" value="a">甲</label>`);
    const adapter=new DomWebAdapter(document,undefined,root), signal=new AbortController().signal;
    const observation=await adapter.observeSession('s',signal), parsed=observation.questions[0]!;
    const element=root.querySelector('input')!;
    element.scrollIntoView=()=>{};
    element.getBoundingClientRect=()=>({x:0,y:0,width:20,height:20,top:0,left:0,right:20,bottom:20,toJSON:()=>({})});
    document.elementFromPoint=()=>element;
    const action=input==='text'?{action_id:'a',kind:'set_value' as const,target_id:'blank_1',value:'答案'}:{action_id:'a',kind:'set_selected' as const,target_id:'opt_1',value:true};
    const result=await adapter.execute({schema_version:SCHEMA_VERSION,session_id:'s',question_id:parsed.question.question_id,observation_id:observation.observation_id,strategy:'unattended',actions:[action],preconditions:['same_surface','same_question_fingerprint','target_available']},parsed.locator_map,signal);
    expect(result[0]!.status).toBe('succeeded');
    expect(input==='text'?element.value:element.checked).toBe(input==='text'?'答案':true);
  });
  it('未知和不一致题型不猜测',async()=>{
    const {root}=fixture('未知题型');const adapter=new DomWebAdapter(document,undefined,root);
    await expect(adapter.observeSession('s',new AbortController().signal)).rejects.toThrow('unknown_native_question_type');
    root.querySelector('.tkTopic_title')!.textContent='多选题';
    await expect(adapter.observeSession('s',new AbortController().signal)).rejects.toThrow('native_question_type_mismatch');
  });
  it('提交前旧反馈不作为本次结果',async()=>{
    const {root}=fixture();root.querySelector('.feedback')!.textContent='回答正确';
    const adapter=new DomWebAdapter(document,undefined,root),signal=new AbortController().signal;
    await adapter.observeSession('s',signal);
    expect((await adapter.readState(signal)).feedback).toBeNull();
  });
  it('错误反馈优先正确反馈',()=>{
    expect(readQuestionFeedback(undefined,'回答正确 回答错误','回答正确 回答错误').feedback).toBe('incorrect');
  });
});
