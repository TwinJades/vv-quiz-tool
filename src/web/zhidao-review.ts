import { isExplicitlyHidden, normalizedText } from './dom-utils';

export interface ZhidaoReviewReading {
  course_id: string;
  /** Public path segment; its assessment/attempt meaning is not established. */
  route_context_id: string;
  exercise_id: string;
  point_id: string;
  context_id: string;
  title: string;
  total: number;
  questions: Array<{ number: number; feedback: 'correct' | 'incorrect' }>;
  source: 'review_page';
  submission: 'unknown';
  passed: null;
  visible_score: null;
  retry_control_visible: boolean;
  retry_allowed: null;
  remaining_attempts: null;
  diagnostics: string[];
}

function unique(root: Element, selector: string): HTMLElement | null {
  const matches = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(e => !isExplicitlyHidden(e));
  return matches.length === 1 ? matches[0]! : null;
}

/** Reads the observed graded judgment review, without hidden input values or
 * reference answers. A review may be an old attempt: it never verifies a new
 * submission, video progress, passing threshold, or permission to retry. */
export function readZhidaoReview(document: Document): ZhidaoReviewReading | null {
  if (document.location.origin !== 'https://ai-smart-course-student-pro.zhihuishu.com') return null;
  const path = /^\/examPreview\/(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)\/?$/.exec(document.location.pathname);
  if (!path) return null;
  const roots = Array.from(document.querySelectorAll<HTMLElement>('.exam-preview')).filter(e => !isExplicitlyHidden(e));
  if (roots.length !== 1) return null;
  const root = roots[0]!;
  const title = unique(root, ':scope > .header > .left > .nodename');
  const tag = unique(root, ':scope > .header > .left > .tag');
  const card = unique(root, '.right-box > .answer-card');
  const section = card && unique(card, '.type-title');
  const list = card && unique(card, '.list');
  if (!title || !normalizedText(title.textContent) || normalizedText(tag?.textContent ?? null) !== '测试题目' ||
    !card || normalizedText(section?.textContent ?? null) !== '知识点练习默认部分' || !list) return null;
  const questions = Array.from(root.querySelectorAll<HTMLElement>('.left-box > .exam-item > ul.question-item'));
  const labels = Array.from(list.querySelectorAll<HTMLElement>('.item'));
  if (!questions.length || questions.length !== labels.length || questions.some(isExplicitlyHidden) || labels.some(isExplicitlyHidden)) return null;
  const results: ZhidaoReviewReading['questions'] = [];
  for (let index = 0; index < questions.length; index++) {
    const question = questions[index]!;
    const number = normalizedText(unique(question, ':scope > .quest-title > .option-index')?.textContent ?? null);
    const type = unique(question, ':scope > .quest-type.judge');
    const feedback = unique(question, ':scope > .question-result');
    const label = labels[index]!;
    if (number !== `${index + 1}、` || normalizedText(type?.textContent ?? null) !== '判断题' || !feedback ||
      normalizedText(label.textContent) !== String(index + 1) || label.classList.contains('green') === label.classList.contains('red')) return null;
    const incorrect = feedback.classList.contains('error');
    if (incorrect !== label.classList.contains('red') ||
      (incorrect ? !/回答错误/.test(normalizedText(feedback.textContent)) : !/回答正确/.test(normalizedText(feedback.textContent)))) return null;
    results.push({ number:index + 1, feedback:incorrect ? 'incorrect' : 'correct' });
  }
  const retry = unique(root, ':scope > .header > .right > .submit');
  return { course_id:path[1]!, route_context_id:path[2]!, exercise_id:path[3]!, point_id:path[4]!, context_id:path[5]!,
    title:normalizedText(title.textContent), total:results.length, questions:results, source:'review_page',
    submission:'unknown', passed:null, visible_score:null,
    retry_control_visible:Boolean(retry && normalizedText(retry.textContent) === '重新答题'), retry_allowed:null, remaining_attempts:null,
    diagnostics:['查看解析只说明已有记录的逐题反馈，不确认当前会话提交或任务完成。',
      '重新答题控件可见不说明允许次数、计分规则或及格条件；不能自动重开。'] };
}
