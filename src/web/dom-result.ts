import type {PlatformState} from '../core/platform';
import {isExplicitlyHidden,elementText} from './dom-utils';

export function readQuestionFeedback(root:HTMLElement|undefined,pageText:string,feedbackText:string):{localGrading:string;feedback:PlatformState['feedback'];feedbackEvidence:string;pointFeedback:PlatformState['feedback']} {
  const localGrading=root&&!isExplicitlyHidden(root)?Array.from(root.querySelectorAll<HTMLElement>('.h5p-question-feedback.h5p-question-visible, .h5p-question-scorebar.h5p-question-visible')).filter(element=>!isExplicitlyHidden(element)).map(element=>elementText(element.querySelector('.h5p-joubelui-score-bar-progress')??element)).join(' '):'';
  const liveGrading=localGrading&&root?Array.from(root.querySelectorAll<HTMLElement>('.h5p-hidden-read[aria-live]')).filter(element=>!isExplicitlyHidden(element)).map(elementText).join(' '):'';
  const pattern=/\byou got\s+(\d+)\s+(?:out\s+)?of\s+(\d+)\s+points?\b/i,points=liveGrading.match(pattern)??localGrading.match(pattern);
  const pointFeedback:PlatformState['feedback']=points&&Number(points[2])>0&&Number(points[1])<=Number(points[2])?Number(points[1])===Number(points[2])?'correct':Number(points[1])===0?'incorrect':'partial':null;
  const strong=pageText.match(/(?:your answer is (?:correct|incorrect)|回答(?:正确|错误)|答(?:对|错)了?)/i)?.[0]??'';
  const feedbackEvidence=`${feedbackText} ${strong} ${localGrading}`;
  const feedback=pointFeedback??(/\bcorrect\b|回答正确|答对/i.test(feedbackEvidence)?'correct':/\bincorrect\b|\bwrong\b|回答错误|答错/i.test(feedbackEvidence)?'incorrect':null);
  return {localGrading,feedback,feedbackEvidence,pointFeedback};
}
