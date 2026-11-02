import {isExplicitlyHidden} from './dom-utils';

// Adapted from chaoxing-ai-assistant a34e9beefe50c2db92625367ca9e49eafc2c143f, MIT.
const roots = '.ans-videoquiz,[data-video-quiz-root]';
const answers = 'input[type=radio],input[type=checkbox],input[type=text],input:not([type]),textarea,[role=radio],[role=checkbox],.radio-view >li';
const questions = '.tkItem,.singleQuesId,.TiMu,.question-item,[data-questionid],fieldset';
const visible = (node: HTMLElement) => node.isConnected && !isExplicitlyHidden(node);
const enabled = (node: HTMLElement) => !node.matches(':disabled,[aria-disabled=true]');

export function findChaoxingVideoQuiz(video: HTMLVideoElement): {root:HTMLElement;holder:HTMLElement;video:HTMLVideoElement}|null {
  if (!visible(video)) return null;
  const doc=video.ownerDocument;
  const candidates=new Set<HTMLElement>(doc.querySelectorAll<HTMLElement>(roots));
  for(const submit of doc.querySelectorAll<HTMLElement>('#videoquiz-submit')) {
    const root=submit.closest<HTMLElement>(roots) ?? submit.closest<HTMLElement>('[role=dialog],dialog,form');
    if(root)candidates.add(root);
  }
  const matches: Array<{root:HTMLElement;holder:HTMLElement;video:HTMLVideoElement}>=[];
  for(const root of candidates) {
    if(!visible(root))continue;
    const explicit=root.closest<HTMLElement>('[data-video-id]')?.getAttribute('data-video-id');
    if(explicit && (!video.id || explicit!==video.id))continue;
    let holder:HTMLElement|null=root;
    while(holder && !holder.querySelector('video'))holder=holder.parentElement;
    if(!holder)continue;
    const videos=Array.from(holder.querySelectorAll<HTMLVideoElement>('video')).filter(visible);
    if(!videos.includes(video))continue;
    if(videos.length!==1)throw new Error('弹题与播放器的归属不唯一。');
    matches.push({root,holder,video});
  }
  const leaf=matches.filter(item=>!matches.some(other=>other!==item && item.root.contains(other.root)));
  if(leaf.length>1)throw new Error('弹题归属不唯一。');
  return leaf[0]??null;
}

export function chaoxingVideoQuizQuestions(root:HTMLElement):HTMLElement[] {
  const candidates=Array.from(root.querySelectorAll<HTMLElement>(questions)).filter(visible);
  const leaves=candidates.filter(node=>!candidates.some(other=>other!==node && node.contains(other)));
  if(leaves.length)return leaves;
  return root.querySelector(answers)?[root]:[];
}
export function chaoxingVideoQuizReady(root:HTMLElement):boolean {
  return visible(root) && Array.from(root.querySelectorAll<HTMLElement>('input[type=radio],input[type=checkbox],input[type=text],input:not([type]),textarea')).some(node=>visible(node)&&enabled(node));
}
export function chaoxingVideoQuizControl(root:HTMLElement,kind:'submit'|'continue'):HTMLElement|null {
  const selector=kind==='submit'?'#videoquiz-submit,[data-video-quiz-submit]':'#videoquiz-continue,.ans-videoquiz-continue,[data-video-quiz-continue],.videoquiz-continue';
  const found=Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(node=>visible(node)&&enabled(node));
  if(found.length>1)throw new Error('弹题操作控件不唯一。');
  return found[0]??null;
}
