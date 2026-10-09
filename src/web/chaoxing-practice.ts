import { isExplicitlyHidden, normalizedText, isElementType } from './dom-utils';

export interface ChaoxingPracticeReading {
  course_id: string;
  lesson_id: string;
  submission: 'unknown';
  visual_text_required: boolean;
  questions: Array<{id:string;number:number;kind:'single_choice'|'multiple_choice';
    raw_heading:string;options:Array<{letter:string;label:string;selected:boolean|null}>}>;
}
/** This platform marks its visually rendered choice UL aria-hidden=true.
 * Only that observed list is exempt from the accessibility hiding marker;
 * actual hidden/CSS-hidden ancestors still exclude the control. */
export function isRenderedChaoxingChoice(element:Element):boolean {
  for(let current:Element|null=element;current;current=current.parentElement){
    if(current.hasAttribute('hidden') || (current.getAttribute('aria-hidden')==='true'&&!current.matches('ul.Zy_ulTop.w-top')))return false;
    const style=current.ownerDocument.defaultView?.getComputedStyle(current);
    if(style?.display==='none'||style?.visibility==='hidden'||style?.visibility==='collapse'||style?.opacity==='0')return false;
  }
  return true;
}
export function readChaoxingPractice(document:Document):ChaoxingPracticeReading|null {
  const url=new URL(document.location.href);
  if(url.origin!=='https://mooc1.chaoxing.com'||url.pathname!=='/mooc-ans/work/doHomeWorkNew')return null;
  const course=url.searchParams.getAll('courseId'),lesson=url.searchParams.getAll('knowledgeid');
  if(course.length!==1||lesson.length!==1||!/^\d+$/.test(course[0]!)||!/^\d+$/.test(lesson[0]!))return null;
  const roots=Array.from(document.querySelectorAll<HTMLElement>('.TiMu.newTiMu')).filter(e=>!isExplicitlyHidden(e));
  if(!roots.length)return null;
  const reading:ChaoxingPracticeReading={course_id:course[0]!,lesson_id:lesson[0]!,submission:'unknown',visual_text_required:false,questions:[]};
  const seen=new Set<string>();
  for(const [index,root] of roots.entries()){
    const headings=Array.from(root.querySelectorAll(':scope > .Zy_TItle')).filter(e=>!isExplicitlyHidden(e));
    const lists=Array.from(root.querySelectorAll('ul.Zy_ulTop.w-top')).filter(isRenderedChaoxingChoice);
    if(headings.length!==1||lists.length!==1)return null;
    const raw=normalizedText(headings[0]!.textContent),number=Number(/^(\d+)\s/.exec(raw)?.[1]);
    const judgment=/【判断题】/.test(raw),multiple=/【多选题】/.test(raw),single=/【单选题】/.test(raw);
    if(number!==index+1||Number(judgment)+Number(multiple)+Number(single)!==1)return null;
    const choices=Array.from(lists[0]!.children) as HTMLElement[];
    if(choices.length<2)return null;
    const qid=choices[0]!.getAttribute('qid');
    if(!qid||!/^\d+$/.test(qid)||seen.has(qid))return null;
    const options:ChaoxingPracticeReading['questions'][number]['options']=[];
    for(const [i,e] of choices.entries()){
      const letter=normalizedText(e.querySelector(':scope > label.before')?.textContent),label=normalizedText(e.querySelector(':scope > a.after')?.textContent);
      if(!e.matches(multiple?'li.before-after-checkbox[role="checkbox"]':'li.before-after[role="radio"]')||!isRenderedChaoxingChoice(e)||
        e.getAttribute('qid')!==qid||e.getAttribute('qtype')!==(judgment?'3':multiple?'1':'0')||letter!==String.fromCharCode(65+i)||!label)return null;
      const checked=e.getAttribute('aria-checked');
      // Unknown until the platform exposes an explicit checked state. Do not
      // infer selection from arbitrary presentation class names.
      options.push({letter,label,selected:checked==='true'?true:checked==='false'?false:null});
    }
    if(judgment&&(options.length!==2||options[0]!.label!=='对'||options[1]!.label!=='错'))return null;
    seen.add(qid);reading.questions.push({id:qid,number,kind:multiple?'multiple_choice':'single_choice',raw_heading:raw,options});
    if(Array.from(root.querySelectorAll('.font-cxsecret')).some(e=>!isExplicitlyHidden(e)))reading.visual_text_required=true;
  }
  return reading;
}

export interface ChaoxingPracticeAnswer {id:string;letters:string[]}
export interface ChaoxingPracticeReviewReading {course_id:string;lesson_id:string;attempt:number;score:number;maximum:number;submission_confirmed:true;passed:null}
export function readChaoxingPracticeReview(document:Document):ChaoxingPracticeReviewReading|null {
  const url=new URL(document.location.href);
  if(url.origin!=='https://mooc1.chaoxing.com'||url.pathname!=='/mooc-ans/work/selectWorkQuestionYiPiYue')return null;
  const courses=url.searchParams.getAll('courseId'),lessons=url.searchParams.getAll('knowledgeid');
  if(courses.length!==1||lessons.length!==1||!/^\d+$/.test(courses[0]!)||!/^\d+$/.test(lessons[0]!))return null;
  const text=normalizedText(document.body?.innerText);
  if(!/^章节测验\s+已完成\s/.test(text))return null;
  const attempts=Array.from(text.matchAll(/第(\d+)次作答\s+本次成绩\s*(\d+(?:\.\d+)?)\s*分/g));
  const maxima=Array.from(text.matchAll(/题量:\s*\d+\s+满分:\s*(\d+(?:\.\d+)?)/g));
  if(attempts.length!==1||maxima.length!==1)return null;
  const attempt=Number(attempts[0]![1]),score=Number(attempts[0]![2]),maximum=Number(maxima[0]![1]);
  if(!Number.isSafeInteger(attempt)||attempt<1||maximum<=0||score<0||score>maximum)return null;
  return {course_id:courses[0]!,lesson_id:lessons[0]!,attempt,score,maximum,submission_confirmed:true,passed:null};
}
function identity(reading:ChaoxingPracticeReading):string {
  return JSON.stringify([reading.course_id,reading.lesson_id,reading.questions.map(q=>[q.id,q.number,q.kind,q.raw_heading,q.options.map(o=>[o.letter,o.label])])]);
}
/** Normal rendered controls only. All model answers must be locally matched
 * to the fresh question/option reading before constructing this action set.
 * This fills and verifies selections; it never submits or infers a grade. */
export function applyChaoxingPracticeAnswers(document:Document,expected:ChaoxingPracticeReading,answers:ChaoxingPracticeAnswer[],signal:AbortSignal):ChaoxingPracticeReading {
  signal.throwIfAborted();
  if(answers.length!==expected.questions.length||new Set(answers.map(a=>a.id)).size!==answers.length)throw new Error('测验答案数量或题目身份不匹配。');
  const fresh=()=>{signal.throwIfAborted();const reading=readChaoxingPractice(document);if(!reading||identity(reading)!==identity(expected))throw new Error('课时、题目或选项身份改变。');return reading;};
  fresh();
  // Validate the whole answer set before the first write.
  for(const q of expected.questions){const answer=answers.find(a=>a.id===q.id);if(!answer||!answer.letters.length||new Set(answer.letters).size!==answer.letters.length||
    (q.kind==='single_choice'&&answer.letters.length!==1)||answer.letters.some(letter=>!q.options.some(o=>o.letter===letter)))throw new Error('模型答案与实际选项不匹配。');}
  for(const q of expected.questions){
    const answer=answers.find(a=>a.id===q.id)!;
    const letters=q.kind==='single_choice'?answer.letters:q.options.map(o=>o.letter);
    for(const letter of letters){
      fresh();const matches=Array.from(document.querySelectorAll<HTMLElement>('li[qid]')).filter(e=>e.getAttribute('qid')===q.id&&
        normalizedText(e.querySelector(':scope > label.before')?.textContent)===letter&&isRenderedChaoxingChoice(e));
      if(matches.length!==1)throw new Error('作答控件不唯一。');const target=matches[0]!;
      if(target.hasAttribute('disabled')||target.getAttribute('aria-disabled')==='true')throw new Error('作答控件已禁用。');
      const wanted=answer.letters.includes(letter);
      // Some observed controls omit aria-checked until the first normal click.
      // Reconcile that toggle using its explicit post-click state, bounded to
      // two ordinary clicks. No hidden saved-answer inputs are read or written.
      for(let attempt=0;attempt<2&&target.getAttribute('aria-checked')!==String(wanted);attempt++){
        fresh();signal.throwIfAborted();target.click();signal.throwIfAborted();
        if(!['true','false'].includes(target.getAttribute('aria-checked')??''))throw new Error('平台没有确认选中状态，停止后续作答。');
      }
      if(target.getAttribute('aria-checked')!==String(wanted))throw new Error('选项填写验证失败。');
    }
  }
  const final=fresh();
  for(const q of final.questions){const wanted=answers.find(a=>a.id===q.id)!.letters;
    if(q.options.some(o=>o.selected===null||o.selected!==wanted.includes(o.letter)))throw new Error('整页填写验证失败。');}
  return final;
}

export async function submitChaoxingPractice(host:Document,work:Document,expected:ChaoxingPracticeReading,signal:AbortSignal):Promise<ChaoxingPracticeReviewReading> {
  signal.throwIfAborted();
  const hostUrl=new URL(host.location.href);
  if(hostUrl.origin!=='https://mooc1.chaoxing.com'||hostUrl.pathname!=='/mycourse/studentstudy'||
    hostUrl.searchParams.get('courseId')!==expected.course_id||hostUrl.searchParams.get('chapterId')!==expected.lesson_id)
    throw new Error('提交前课程或课时身份改变。');
  const workFrame=work.defaultView?.frameElement;
  if(!workFrame||!isElementType(workFrame,'iframe'))throw new Error('提交测验缺少实际关联框架。');
  const currentWork=():Document|null=>{
    const cards=host.querySelector<HTMLIFrameElement>('iframe#iframe')?.contentDocument;
    if(!cards)return null;
    const frames=Array.from(cards.querySelectorAll<HTMLIFrameElement>('iframe')).filter(frame=>
      new URL(frame.src,cards.location.href).pathname==='/ananas/modules/work/index.html');
    const matching=frames.map(frame=>frame.contentDocument?.querySelector<HTMLIFrameElement>('iframe#frame_content')).filter(frame=>frame===workFrame);
    return matching.length===1&&workFrame.isConnected?workFrame.contentDocument:null;
  };
  if(currentWork()!==work)throw new Error('提交前关联测验frame已经改变。');
  const current=readChaoxingPractice(work);
  if(!current||identity(current)!==identity(expected)||current.questions.some((question,index)=>
    question.options.some((option,optionIndex)=>option.selected===null||option.selected!==expected.questions[index]!.options[optionIndex]!.selected)))
    throw new Error('提交前题目、选项或填写状态改变。');
  if(current.questions.some(question=>{
    const selected=question.options.filter(option=>option.selected).length;
    return selected===0||question.kind==='single_choice'&&selected!==1;
  }))
    throw new Error('提交前仍有未作答题目。');
  if(Array.from(host.querySelectorAll<HTMLElement>('a#popok[role="button"]')).some(element=>!isExplicitlyHidden(element)))
    throw new Error('已有待确认的提交弹窗，禁止重复点击提交。');
  const buttons=Array.from(work.querySelectorAll<HTMLElement>('.btnSubmit.workBtnIndex')).filter(element=>
    !isExplicitlyHidden(element)&&element.getClientRects().length>0&&normalizedText(element.innerText)==='提交'&&
    !element.hasAttribute('disabled')&&element.getAttribute('aria-disabled')!=='true');
  if(buttons.length!==1)throw new Error('正常提交控件缺失或不唯一。');
  signal.throwIfAborted();buttons[0]!.click();
  const until=Date.now()+5000;
  let confirm:HTMLElement|null=null;
  while(Date.now()<until){
    signal.throwIfAborted();
    const candidates=Array.from(host.querySelectorAll<HTMLElement>('a#popok[role="button"]')).filter(element=>
      !isExplicitlyHidden(element)&&element.getClientRects().length>0&&normalizedText(element.innerText)==='提交'&&
      normalizedText(element.parentElement?.parentElement?.innerText).includes('确认提交？')&&
      element.parentElement?.parentElement?.querySelector('#popno'));
    if(candidates.length>1)throw new Error('提交确认控件不唯一。');
    if(candidates.length===1){confirm=candidates[0]!;break;}
    await new Promise<void>(resolve=>setTimeout(resolve,100));
  }
  if(!confirm)throw new Error('点击提交后没有出现已观察的确认弹窗；提交状态需要重新核对。');
  signal.throwIfAborted();confirm.click();
  const resultUntil=Date.now()+30000;
  while(Date.now()<resultUntil){
    signal.throwIfAborted();
    const resultDocument=currentWork();
    const result=resultDocument?readChaoxingPracticeReview(resultDocument):null;
    if(result){
      if(result.course_id!==expected.course_id||result.lesson_id!==expected.lesson_id)
        throw new Error('公开结果不属于本次课时。');
      return result;
    }
    await new Promise<void>(resolve=>setTimeout(resolve,200));
  }
  throw new Error('确认提交后公开结果尚未出现；禁止重复提交，需要重新核对。');
}
