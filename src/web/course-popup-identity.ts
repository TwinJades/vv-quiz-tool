import {fnv1a,normalizedText,isExplicitlyHidden,labelText} from './dom-utils';
import {publicCourseUrl} from './public-course-url';
import {chaoxingVideoQuizQuestions} from './chaoxing-video-quiz';

export function coursePopupIdentity(taskId:string,root:HTMLElement):string {
  const questions=chaoxingVideoQuizQuestions(root);
  if(!questions.length)throw new Error('弹题没有可核验的实际题目。');
  const identity=questions.map(question=>{
    const choices=Array.from(question.querySelectorAll<HTMLElement>('input[type=radio],input[type=checkbox],[role=radio],[role=checkbox],.radio-view >li')).filter(element=>!isExplicitlyHidden(element));
    const blanks=Array.from(question.querySelectorAll<HTMLElement>('input[type=text],input:not([type]),textarea')).filter(element=>!isExplicitlyHidden(element));
    if(!choices.length&&!blanks.length)throw new Error('弹题没有可核验的实际选项或填空。');
    const clone=question.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input,textarea,select,button,[role=radio],[role=checkbox],.radio-view, .feedback,.answer-feedback,.result,[data-feedback],[role=alert],[aria-live],#videoquiz-submit,#videoquiz-continue,.ans-videoquiz-continue,.videoquiz-continue,[data-video-quiz-submit],[data-video-quiz-continue],script,style').forEach(node=>node.remove());
    const stem=normalizedText(question.querySelector(':scope > .tkItem_title,[data-question-stem],.question-text,.question-title,.stem')?.textContent ?? clone.textContent);
    const images=Array.from(question.querySelectorAll<HTMLImageElement>('img[src]')).filter(image=>!isExplicitlyHidden(image)&&!image.closest('.feedback,.answer-feedback,.result,[data-feedback]')).map(image=>{try{return publicCourseUrl(new URL(image.getAttribute('src')!,image.ownerDocument.location.href).href);}catch{return image.getAttribute('src');}});
    return {id:question.getAttribute('data-questionid')||question.getAttribute('data-question-id')||question.id||null,cue:question.getAttribute('data-cue')||root.getAttribute('data-cue')||null,stem,images,options:choices.map(element=>({id:element.id,name:element.getAttribute('name'),value:element.getAttribute('value'),text:labelText(element.ownerDocument,element)||normalizedText(element.textContent)})),blanks:blanks.length};
  });
  return `popup:${taskId}:${fnv1a(JSON.stringify(identity))}`;
}
