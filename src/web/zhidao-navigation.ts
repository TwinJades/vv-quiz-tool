import { isExplicitlyHidden, normalizedText } from './dom-utils';
import { readZhidaoDirectory } from './zhidao-directory';
import { readZhidaoPractice } from './zhidao-practice';
import { readZhidaoReview } from './zhidao-review';
import { readZhidaoResult } from './zhidao-result';

export interface ZhidaoNavigationReading {
  stage: 'directory' | 'learner' | 'mastery_history' | 'practice' | 'review' | 'result';
  course_id: string;
  context_id: string | null;
  point_id: string | null;
  exercise_id: string | null;
  ready: boolean;
  improve_available: boolean;
  diagnostics: string[];
}

const improveSelector = {
  learner: 'button.simplified-mastery__action',
  mastery_history: '.mastery-header .mastery-title .improve-btn',
} as const;

function controls(document: Document, stage: keyof typeof improveSelector): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(improveSelector[stage])).filter(e =>
    !isExplicitlyHidden(e) && !e.hasAttribute('disabled') && e.getAttribute('aria-disabled') !== 'true' &&
    (stage === 'learner' ? normalizedText(e.textContent) === '去提升' : normalizedText(e.textContent) === '去提升 →'));
}

/** Observed PPT learner surface, only for associated-practice navigation.
 * It does not read pages or infer document completion. */
export function isZhidaoPptLearner(document:Document):boolean {
  if(Array.from(document.querySelectorAll('video')).some(v=>!isExplicitlyHidden(v)))return false;
  const previews=Array.from(document.querySelectorAll('.preview-content >.ppt-preview-box >.ppt-preview-container')).filter(e=>!isExplicitlyHidden(e));
  const active=Array.from(document.querySelectorAll('.resources-section .resources-list >.basic-info-video-card-container.active')).filter(e=>!isExplicitlyHidden(e));
  return previews.length===1&&active.length===1&&/^\d+页$/.test(normalizedText(active[0]!.querySelector('.page-num')?.textContent))&&
    /\.pptx?$/i.test(normalizedText(active[0]!.querySelector('.video-title')?.textContent));
}

/** A rendered, identified video card may remain while the media widget failed
 * to mount. Normal practice/back navigation is allowed with no live media;
 * this surface never supplies playback, duration or completion evidence. */
export function isZhidaoPendingVideoLearner(document:Document):boolean {
  const wrappers=Array.from(document.querySelectorAll('.preview-content >.video-player-wrapper >[resourceid] >.videoNameBox')).filter(e=>!isExplicitlyHidden(e));
  const cards=Array.from(document.querySelectorAll('.resources-section .resources-list >.basic-info-video-card-container.active')).filter(e=>!isExplicitlyHidden(e));
  const videos=Array.from(document.querySelectorAll('video')).filter(v=>!isExplicitlyHidden(v));
  // Actual failed initialization can leave the original source-free <video>
  // stub rather than an empty wrapper. It is safe only for normal navigation;
  // it supplies no media progress, playable video or completion evidence.
  if(videos.length&&(videos.length!==1||videos[0]!.parentElement!==wrappers[0]||
    !videos[0]!.classList.contains('video-js')||videos[0]!.classList.contains('vjs-tech')||
    !videos[0]!.paused||videos[0]!.readyState!==0||videos[0]!.currentSrc!==''||
    videos[0]!.hasAttribute('src')||videos[0]!.querySelector('source[src]')))return false;
  return wrappers.length===1&&/^\d+$/.test(wrappers[0]!.parentElement?.getAttribute('resourceid')??'')&&cards.length===1&&
    !!cards[0]!.querySelector('.icon-box.video')&&/^\d{2}:\d{2}:\d{2}$/.test(normalizedText(cards[0]!.querySelector('.page-num')?.textContent))&&
    !!normalizedText(cards[0]!.querySelector('.video-title')?.textContent);
}

/** Public route IDs remain strings. Each improve control belongs to a different
 * page; a caller must observe the new identity before resolving another step.
 * Opaque practice path data is neither decoded nor used as task association. */
export function readZhidaoNavigation(document: Document): ZhidaoNavigationReading | null {
  const url = new URL(document.location.href);
  if (url.origin === 'https://ai-smart-course-student-pro.zhihuishu.com') {
    const result=readZhidaoResult(document);
    if(result)return {stage:'result',course_id:result.course_id,context_id:result.context_id,point_id:result.point_id,
      exercise_id:result.exercise_id,ready:true,improve_available:false,diagnostics:['知识点报告不是独立的新提交证明；需由本次提交会话核对。']};
    const review = readZhidaoReview(document);
    if (review) return { stage:'review', course_id:review.course_id, context_id:review.context_id, point_id:review.point_id,
      exercise_id:review.exercise_id, ready:true, improve_available:false, diagnostics:[...review.diagnostics] };
    const directory = /^\/singleCourse\/knowledgeStudy\/(\d+)\/(\d+)\/?$/.exec(url.pathname);
    if (directory) return { stage:'directory', course_id:directory[1]!, context_id:directory[2]!, point_id:null,
      exercise_id:null, ready:readZhidaoDirectory(document) !== null, improve_available:false, diagnostics:[] };
    const learner = /^\/learnPage\/(\d+)\/(\d+)\/(\d+)\/?$/.exec(url.pathname);
    const history = /^\/masteryHistory\/(\d+)\/(\d+)\/(\d+)\/?$/.exec(url.pathname);
    if (learner || history) {
      const path = (learner ?? history)!;
      const stage = learner ? 'learner' : 'mastery_history';
      const roots = Array.from(document.querySelectorAll(stage === 'learner'
        ? '.videoNameBox.able-player-container' : '.mastery-history-container')).filter(e => !isExplicitlyHidden(e));
      const ready = stage==='learner'?(roots.length===1&&roots[0]!.querySelectorAll('video.vjs-tech').length===1||isZhidaoPptLearner(document)||isZhidaoPendingVideoLearner(document)):roots.length===1;
      return { stage, course_id:path[1]!, point_id:learner?path[2]!:path[3]!, context_id:learner?path[3]!:path[2]!,
        exercise_id:null, ready, improve_available:ready && controls(document,stage).length === 1,
        diagnostics:ready?[]:['当前路由的已观察页面结构尚未就绪，不能导航。'] };
    }
  }
  if (url.origin === 'https://studentexamcomh5.zhihuishu.com') {
    const path = /^\/studentReviewTestOrExam\/(\d+)\/1\/1\/(\d+)\//.exec(url.pathname);
    const publicId=(name:string):string|null=>{
      const values=url.searchParams.getAll(name);
      return values.length===1&&/^\d+$/.test(values[0]!)?values[0]!:null;
    };
    if (path) return { stage:'practice', course_id:path[2]!, context_id:publicId('classId'), point_id:publicId('pointId'), exercise_id:path[1]!,
      ready:readZhidaoPractice(document) !== null, improve_available:false,
      diagnostics:[publicId('classId')&&publicId('pointId')?'公开练习参数提供知识点与班级身份，仍须与父导航核对。':'练习公开路径只确认课程与练习ID；课时归属必须由父导航和页面证据分别核对。',
        '练习就绪不证明计分、重试、及格规则或提交完成。'] };
  }
  return null;
}

/** These two observed back icons both return to a learner which can autoplay.
 * The caller must mute the tab beforehand and pause/verify after navigation. */
export function resolveZhidaoReportReturn(document:Document,expected:ZhidaoNavigationReading):HTMLElement {
  const current=readZhidaoNavigation(document);
  if(!current?.ready||!expected.ready||current.stage!==expected.stage||
    (current.stage!=='result'&&current.stage!=='mastery_history')||current.course_id!==expected.course_id||
    current.point_id!==expected.point_id||current.context_id!==expected.context_id||current.exercise_id!==expected.exercise_id)
    throw new Error('报告返回的课程、知识点或步骤已改变。');
  const selector=current.stage==='result'?'.point >.backup >.backup-icon':'.mastery-history-container >.backup >.backup-content >.backup-icon';
  const elements=Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(e=>!isExplicitlyHidden(e)&&
    !e.hasAttribute('disabled')&&e.getAttribute('aria-disabled')!=='true');
  if(elements.length!==1)throw new Error('报告正常返回控件不可用或不唯一。');
  return elements[0]!;
}

/** The observed practice return led to masteryHistory, not directly to the
 * directory. Re-observe that destination before any subsequent navigation. */
export function resolveZhidaoPracticeReturn(document: Document, expected: ZhidaoNavigationReading): HTMLElement {
  const current = readZhidaoNavigation(document);
  if (!current?.ready || !expected.ready || current.stage !== 'practice' || expected.stage !== 'practice' ||
    current.course_id !== expected.course_id || current.exercise_id !== expected.exercise_id ||
    current.point_id !== expected.point_id || current.context_id !== expected.context_id) throw new Error('练习返回的课程或练习身份已改变。');
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('.exam-test .header-content span.back')).filter(e =>
    !isExplicitlyHidden(e) && !e.hasAttribute('disabled') && e.getAttribute('aria-disabled') !== 'true' && normalizedText(e.textContent) === '返回');
  if (candidates.length !== 1) throw new Error('练习返回控件不可用或不唯一。');
  return candidates[0]!;
}

/** The observed learner back image returns to the course directory. Leaving
 * the learner requires paused media; closing an assessment preview instead can
 * return to an autoplaying learner, so these controls are never interchangeable. */
export function resolveZhidaoLearnerReturn(document: Document, expected: ZhidaoNavigationReading): HTMLElement {
  const current = readZhidaoNavigation(document);
  if (!current?.ready || !expected.ready || current.stage !== 'learner' || expected.stage !== 'learner' ||
    current.course_id !== expected.course_id || current.point_id !== expected.point_id ||
    current.context_id !== expected.context_id) throw new Error('学习页返回的课程或知识点身份已改变。');
  const videos = document.querySelectorAll<HTMLVideoElement>('.videoNameBox.able-player-container > .video-js > video.vjs-tech');
  if (videos.length ? videos.length!==1||!videos[0]!.paused : !isZhidaoPptLearner(document)&&!isZhidaoPendingVideoLearner(document)) throw new Error('返回目录前必须先确认视频已暂停或当前已核对且没有活动媒体。');
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('.learn-header > img[alt="back"]')).filter(e =>
    !isExplicitlyHidden(e) && !e.hasAttribute('disabled') && e.getAttribute('aria-disabled') !== 'true' &&
    document.defaultView?.getComputedStyle(e).cursor === 'pointer' && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0);
  if (candidates.length !== 1) throw new Error('学习页返回目录控件不可用或不唯一。');
  return candidates[0]!;
}

/** Resolve a normal control only against the caller's exact observed step.
 * This function never clicks, plays media, submits, or supplies unknown rules. */
export function resolveZhidaoImprove(document: Document, expected: ZhidaoNavigationReading): HTMLElement {
  const current = readZhidaoNavigation(document);
  if (!current || !current.ready || !expected.ready ||
    current.stage !== expected.stage || current.course_id !== expected.course_id ||
    current.context_id !== expected.context_id || current.point_id !== expected.point_id ||
    !current.point_id || !current.context_id ||
    (current.stage !== 'learner' && current.stage !== 'mastery_history')) throw new Error('去提升导航的课程、知识点或步骤已改变。');
  const candidates = controls(document,current.stage);
  if (candidates.length !== 1) throw new Error('去提升控件不可用或不唯一。');
  return candidates[0]!;
}

/** Structural material only; span/div controls are not executable quiz targets. */
export function observedZhidaoElements(document: Document, reading: ZhidaoNavigationReading | null): HTMLElement[] {
  if (!reading?.ready) return [];
  const selectors: Record<ZhidaoNavigationReading['stage'], string> = {
    directory: '.knowledge .knowledge-content,.knowledge [knowledgeid],.knowledge .item-title,.knowledge .bottom-text,.knowledge .el-progress__text',
    learner: '.learn-header,.learn-header > img[alt="back"],.left-section .section-item-collapse-info,.videoNameBox.able-player-container,.able-player-container .controlsBar,.controlsBar > .playButton,.controlsBar .volumeIcon,.controlsBar .speedBox,.speedBox .speedTab,button.simplified-mastery__action,.resources-section,.resources-detail-title,.resources-list-box,.resources-list,.resources-list > .basic-info-video-card-container,.video-info,.icon-box',
    mastery_history: '.mastery-history-container,.mastery-header .mastery-title .improve-btn,.history-title,.history-item,button.history-item-btn',
    practice: '.exam-test .header-content,.exam-test span.back,.exam-test span.reviewDone,.ETC-right .reviewS.stu-sheet,.stu-sheet .el-tree-node__content,.stu-sheet .custom-tree-answer-normal',
    review: '.exam-preview > .header,.exam-preview .nodename,.exam-preview .close-btn,.exam-preview .header .submit,.exam-preview ul.question-item,.exam-preview .quest-title,.exam-preview .question-result,.exam-preview .answer-card,.answer-card .list .item',
    result: '.point >.backup,.point >.point-main >.line1 >.line1-left .line1-count',
  };
  return Array.from(document.querySelectorAll<HTMLElement>(selectors[reading.stage])).filter(e => !isExplicitlyHidden(e));
}
