import { readZhidaoNavigation } from './zhidao-navigation';
import { readChaoxingDirectory } from './chaoxing-directory';

/** Protect the observed real course surfaces with the existing synchronous
 * interaction latch. This does not enable actions on those surfaces. */
export function isObservedCourseInteraction(document: Document, target: EventTarget | null): boolean {
  const ElementClass = document.defaultView?.Element;
  if (!ElementClass || !(target instanceof ElementClass)) return false;
  const zhidao = readZhidaoNavigation(document);
  if (zhidao?.ready) {
    switch (zhidao.stage) {
      case 'directory': return Boolean(target.closest('.knowledge .knowledge-content'));
      case 'learner': return Boolean(target.closest('.learn-header,.left-section .section-item-content,.videoNameBox.able-player-container,button.simplified-mastery__action,.resources-section'));
      case 'mastery_history': return Boolean(target.closest('.mastery-history-container'));
      case 'practice': return Boolean(target.closest('.exam-test .questionContent,.exam-test .pre-next,.exam-test .header-content,.ETC-right .reviewS.stu-sheet'));
      case 'review': return Boolean(target.closest('.exam-preview'));
      case 'result': return Boolean(target.closest('.point >.backup,.point >.point-main >.line1'));
    }
  }
  const chaoxing = readChaoxingDirectory(document);
  const row = target.closest<HTMLElement>('.chapter_item[id]');
  return Boolean(chaoxing && row && chaoxing.lessons.some(lesson => row.id === `cur${lesson.id}`));
}
