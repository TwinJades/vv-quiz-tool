import {fnv1a,normalizedText,isExplicitlyHidden} from './dom-utils';
import {publicCourseUrl} from './public-course-url';

export function coursePopupIdentity(taskId:string,root:HTMLElement):string {
  const options=[...root.querySelectorAll<HTMLElement>('input[type=radio],input[type=checkbox],[role=radio],[role=checkbox],.radio-view >li')].filter(element=>!isExplicitlyHidden(element));
  if(!options.length)throw new Error('弹题没有可核验的实际选项。');
  const labels=options.map(element=>normalizedText(element.closest('label')?.textContent||element.textContent)),text=normalizedText(root.innerText||root.textContent);
  const first=labels.find(Boolean),stem=first&&text.includes(first)?text.slice(0,text.indexOf(first)):text;
  const images=[...root.querySelectorAll('img[src]')].map(image=>publicCourseUrl(new URL(image.getAttribute('src')!,image.ownerDocument.location.href).href));
  const identity=JSON.stringify({stem,images,options:options.map((element,index)=>({id:element.id,name:element.getAttribute('name'),value:element.getAttribute('value'),text:labels[index]}))});
  return `popup:${taskId}:${fnv1a(identity)}`;
}
