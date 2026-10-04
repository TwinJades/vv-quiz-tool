import { isExplicitlyHidden, normalizedText } from './dom-utils';

export interface ZhidaoResultReading {
  course_id: string;
  exercise_id: string;
  point_id: string;
  context_id: string;
  title: string;
  total: number;
  correct: number;
  /** Mastery and best-result percentages are deliberately not a test grade. */
  submission: 'unknown';
  passed: null;
}

/** Public, rendered post-practice report only. Opening an old report supplies
 * no evidence of a new submission; its recommendations/answers are not read. */
export function readZhidaoResult(document: Document): ZhidaoResultReading | null {
  if (document.location.origin !== 'https://ai-smart-course-student-pro.zhihuishu.com') return null;
  const path = /^\/point\/(\d+)\/\d+\/(\d+)\/(\d+)\/(\d+)\/?$/.exec(document.location.pathname);
  if (!path) return null;
  const unique = (selector: string): HTMLElement | null => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(e => !isExplicitlyHidden(e));
    return elements.length === 1 ? elements[0]! : null;
  };
  const title = unique('.point > .backup .backup-title');
  const root = unique('.point > .point-main > .line1 > .line1-left > .line1-count');
  const link = unique('.point > .point-main > .line1 > .line1-left .line1-count-link');
  if (!title || !normalizedText(title.textContent) || !root ||
    normalizedText(link?.textContent) !== '查看作答记录与解析') return null;
  const counts = Array.from(root.querySelectorAll<HTMLElement>('.line1-count-total')).filter(e => !isExplicitlyHidden(e));
  if (counts.length !== 2) return null;
  const numbers: number[] = [];
  for (const [index, count] of counts.entries()) {
    const labels = count.querySelectorAll(':scope > .line1-count-total-title');
    const values = count.querySelectorAll(':scope > .line1-count-total-num');
    const value = normalizedText(values[0]?.textContent);
    if (labels.length !== 1 || values.length !== 1 ||
      normalizedText(labels[0]!.textContent) !== ['总题数', '已答对'][index] || !/^\d+$/.test(value)) return null;
    numbers.push(Number(value));
  }
  const [total, correct] = numbers as [number, number];
  if (!Number.isSafeInteger(total) || total < 1 || !Number.isSafeInteger(correct) || correct > total) return null;
  return { course_id:path[1]!, exercise_id:path[2]!, point_id:path[3]!, context_id:path[4]!,
    title:normalizedText(title.textContent), total, correct, submission:'unknown', passed:null };
}

/** Kept in the parent runtime across a hard navigation, never in site storage.
 * A report is usable only after this session's one normal submit action. */
export class ZhidaoSubmissionReceipt {
  #pending: { course:string; exercise:string; point:string|null; context:string|null; total:number; session:string; observation:string; fingerprint:string } | null = null;
  observe(surface: string, total: number | null, session: string, observation: string, fingerprint: string): void {
    if (this.#pending) return;
    let url: URL; try { url = new URL(surface); } catch { return; }
    const path = /^\/studentReviewTestOrExam\/(\d+)\/1\/1\/(\d+)\//.exec(url.pathname);
    if (url.origin !== 'https://studentexamcomh5.zhihuishu.com' || !path || total === null || !Number.isSafeInteger(total) || total < 1) return;
    const id=(name:string):string|null=>{const values=url.searchParams.getAll(name);return values.length===1&&/^\d+$/.test(values[0]!)?values[0]!:null;};
    // Present but malformed/duplicate public association cannot authorize a receipt.
    if((url.searchParams.has('pointId')&&!id('pointId'))||(url.searchParams.has('classId')&&!id('classId')))return;
    this.#pending = {course:path[2]!,exercise:path[1]!,point:id('pointId'),context:id('classId'),total,session,observation,fingerprint};
  }
  #submitted = false;
  get awaiting(): boolean { return this.#submitted; }
  rejectFailedAction(): void { this.#submitted = false; }
  arm(session: string, observation: string, fingerprint: string): boolean {
    if (!this.#pending || this.#pending.session !== session || this.#pending.observation !== observation || this.#pending.fingerprint !== fingerprint || this.#submitted) return false;
    this.#submitted = true; return true;
  }
  /** Refresh the observation lease while still on the exact practice. */
  refresh(surface: string, total: number | null, session: string, observation: string, fingerprint: string): void {
    if (this.#submitted) return;
    this.#pending = null; this.observe(surface,total,session,observation,fingerprint);
  }
  reconcile(result: ZhidaoResultReading | null): { observation_id:string; fingerprint:string; visible_score:string } | null {
    const pending = this.#pending;
    if (!this.#submitted || !pending || !result || result.course_id !== pending.course ||
      result.exercise_id !== pending.exercise || result.total !== pending.total ||
      (pending.point!==null&&result.point_id!==pending.point)||(pending.context!==null&&result.context_id!==pending.context)) return null;
    return { observation_id:pending.observation, fingerprint:`zhidao-result:${result.course_id}:${result.exercise_id}:${result.point_id}:${result.context_id}`,
      visible_score:`答对 ${result.correct}/${result.total}` };
  }
}
