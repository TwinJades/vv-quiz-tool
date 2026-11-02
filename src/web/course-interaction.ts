import { readZhidaoNavigation } from './zhidao-navigation';
import { readChaoxingDirectory } from './chaoxing-directory';

/** Protect the observed real course surfaces with the existing synchronous
 * interaction latch. This does not enable actions on those surfaces. */
export function isObservedCourseInteraction(document: Document, target: EventTarget | null): boolean {
  const ElementClass = document.defaultView?.Element;
  if (!ElementClass || !(target instanceof ElementClass)) return false;
  if(target.closest('input,textarea,select,[role=radio],[role=checkbox],.radio-view >li,.tkItem,.TiMu'))return true;
  if(target.closest('video,.vjs-play-control,[data-course-pause],[data-player-pause],button[aria-label*="暂停"],button[title*="暂停"],.playButton,.pauseButton,.controlsBar .playBox'))return true;
  const zhidao = readZhidaoNavigation(document);
  if (zhidao?.ready) {
    switch (zhidao.stage) {
      case 'directory': return Boolean(target.closest('.item-content[knowledgeid]'));
      case 'learner': return Boolean(target.closest('.learn-header >img[alt=back],.basic-info-video-card-container,button.simplified-mastery__action'));
      case 'mastery_history': return Boolean(target.closest('.history-item,.backup-content'));
      case 'practice': return Boolean(target.closest('.exam-test .questionContent,.exam-test .pre-next,.exam-test .header-content,.ETC-right .reviewS.stu-sheet'));
      case 'review': return Boolean(target.closest('.exam-preview'));
      case 'result': return Boolean(target.closest('.point >.backup,.point >.point-main >.line1'));
    }
  }
  const chaoxing = readChaoxingDirectory(document);
  const row = target.closest<HTMLElement>('.chapter_item[id],.posCatalog_select[id]');
  return Boolean(chaoxing&&row&&target.closest('.posCatalog_name,.clicktitle,a[href]')&&chaoxing.lessons.some(lesson=>row.id===`cur${lesson.id}`));
}
