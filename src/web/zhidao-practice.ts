import { isExplicitlyHidden, normalizedText } from './dom-utils';

export const ZHIDAO_CHOICE_SELECTOR = '.exam-test .questionContent > ul.radio-view > li.clearfix';
export const ZHIDAO_NEXT_SELECTOR = '.exam-test .pre-next > span.next-topic.next-t';
export const ZHIDAO_SUBMIT_SELECTOR = '.exam-test .header-content span.reviewDone';

function practiceDocument(document: Document): boolean {
  const location = document.location;
  return Boolean(location && location.origin === 'https://studentexamcomh5.zhihuishu.com' &&
    /^\/studentReviewTestOrExam\/\d+\/1\/1\/\d+\//.test(location.pathname));
}

export interface ZhidaoPracticeReading {
  exercise_id: string;
  course_id: string;
  current: number;
  total: number;
  questions: Array<{ number: number; answered: boolean }>;
  submission: 'unknown';
}

/** The observed expanded answer card describes saved answer presence only.
 * It does not establish correctness, a score, retry rules or submission. */
export function readZhidaoPractice(document: Document): ZhidaoPracticeReading | null {
  if (!practiceDocument(document)) return null;
  const roots = Array.from(document.querySelectorAll('.exam-test .questionContent')).filter(e => zhidaoPracticeRoot(e));
  if (roots.length !== 1) return null;
  const heading = normalizedText(roots[0]!.querySelector(':scope > .questionName .questionTitle')!.textContent);
  const current = Number(/^(\d+)\./.exec(heading)?.[1]);
  const cards = Array.from(document.querySelectorAll('.ETC-right .reviewS.stu-sheet')).filter(e => !isExplicitlyHidden(e));
  if (cards.length !== 1 || normalizedText(cards[0]!.querySelector(':scope > .sheet-title')?.textContent) !== '答题卡') return null;
  const trees = cards[0]!.querySelectorAll('.el-tree');
  if (trees.length !== 1) return null;
  const sections = trees[0]!.querySelectorAll(':scope > .el-tree-node');
  if (sections.length !== 1 || isExplicitlyHidden(sections[0]!)) return null;
  const section = sections[0]!;
  if (!section.matches('.el-tree-node.is-expanded') ||
    normalizedText(section.querySelector(':scope > .el-tree-node__content')?.textContent) !== '知识点练习默认部分') return null;
  const branches = section.querySelectorAll(':scope > .el-tree-node__children');
  if (branches.length !== 1 || isExplicitlyHidden(branches[0]!)) return null;
  const labels = Array.from(cards[0]!.querySelectorAll('.custom-tree-answer-normal > .font-sec-style-node')).filter(e => !isExplicitlyHidden(e));
  if (branches[0]!.children.length !== labels.length || Array.from(branches[0]!.children).some(e =>
    !e.matches('.el-tree-node') || isExplicitlyHidden(e) || e.querySelectorAll(':scope > .el-tree-node__content .font-sec-style-node').length !== 1 ||
    Array.from(e.querySelectorAll(':scope > .el-tree-node__children')).some(child => child.children.length > 0))) return null;
  const questions: ZhidaoPracticeReading['questions'] = [];
  for (const label of labels) {
    const text = normalizedText(label.textContent);
    const parent = label.parentElement!;
    if (!/^\d+$/.test(text) || parent.classList.contains('answer') === parent.classList.contains('no-answer')) return null;
    questions.push({ number: Number(text), answered: parent.classList.contains('answer') });
  }
  // Missing/collapsed/duplicate card items must not become a false total.
  if (!questions.length || questions.some((q, index) => !Number.isSafeInteger(q.number) || q.number !== index + 1) ||
    !Number.isSafeInteger(current) || current < 1 || current > questions.length) return null;
  const next = Array.from(document.querySelectorAll('.exam-test .pre-next > span.next-topic')).filter(e => !isExplicitlyHidden(e));
  if (next.length !== 1 || normalizedText(next[0]!.textContent) !== '下一题' ||
    (current < questions.length ? !isZhidaoNext(next[0]!) : !next[0]!.classList.contains('noNext') || next[0]!.classList.contains('next-t'))) return null;
  const path = /^\/studentReviewTestOrExam\/(\d+)\/1\/1\/(\d+)\//.exec(document.location.pathname)!;
  return { exercise_id: path[1]!, course_id: path[2]!, current, total: questions.length, questions, submission: 'unknown' };
}

/** Judgment semantics remain a subset of the observed custom radio layout. */
export function zhidaoJudgmentRoot(element: Element): HTMLElement | null {
  const root = zhidaoRadioRoot(element);
  return root && /^\d+\.\s*判断题$/.test(normalizedText(root.querySelector(':scope > .questionName .questionTitle')?.textContent)) ? root : null;
}

export function zhidaoRadioRoot(element: Element): HTMLElement | null {
  if (!practiceDocument(element.ownerDocument)) return null;
  const root = element.closest<HTMLElement>('.exam-test .questionContent');
  if (!root || isExplicitlyHidden(root)) return null;
  const titles = root.querySelectorAll(':scope > .questionName .questionTitle');
  const stems = root.querySelectorAll(':scope > .questionName .centent-pre > pre.preStyle');
  const lists = root.querySelectorAll(':scope > ul.radio-view');
  if (titles.length !== 1 || stems.length !== 1 || lists.length !== 1 ||
    !/^\d+\.\s*(?:判断题|单选题)$/.test(normalizedText(titles[0]!.textContent)) || !normalizedText(stems[0]!.textContent)) return null;
  const options = Array.from(lists[0]!.children);
  if (options.length < 2 || options.some((e,index) => !e.matches('li.clearfix') || isExplicitlyHidden(e) ||
    e.querySelectorAll(':scope > i.checkIcon').length !== 1 || e.querySelectorAll(':scope > .stem').length !== 1 ||
    normalizedText(e.querySelector(':scope > .letterSort')?.textContent) !== `${String.fromCharCode(65+index)}.` ||
    !normalizedText(e.querySelector(':scope > .stem')?.textContent))) return null;
  const labels = options.map(e => normalizedText(e.querySelector(':scope > .stem')!.textContent));
  if (/判断题$/.test(normalizedText(titles[0]!.textContent)) && (options.length!==2 || labels[0] !== '对' || labels[1] !== '错')) return null;
  return root;
}

export function isZhidaoChoice(element: Element): boolean {
  return element.matches(ZHIDAO_CHOICE_SELECTOR) && zhidaoRadioRoot(element) !== null;
}

/** The observed native checkbox layout uses public labels and normal inputs.
 * Validate the entire question before trusting its card or navigation controls. */
export function zhidaoPracticeRoot(element: Element): HTMLElement | null {
  const judgment = zhidaoRadioRoot(element);
  if (judgment) return judgment;
  if (!practiceDocument(element.ownerDocument)) return null;
  const root = element.closest<HTMLElement>('.exam-test .questionContent');
  if (!root || isExplicitlyHidden(root)) return null;
  const titles = root.querySelectorAll(':scope > .questionName .questionTitle');
  const stems = root.querySelectorAll(':scope > .questionName .centent-pre > pre.preStyle');
  const groups = root.querySelectorAll(':scope > .checkbox-views > div > .el-checkbox-group.checkbox-view');
  if (titles.length !== 1 || stems.length !== 1 || groups.length !== 1 ||
    !/^\d+\.\s*多选题$/.test(normalizedText(titles[0]!.textContent)) || !normalizedText(stems[0]!.textContent)) return null;
  const options = Array.from(groups[0]!.children);
  if (options.length < 2 || options.some((option, index) => {
    const inputs = option.querySelectorAll(':scope > .el-checkbox__input > input.el-checkbox__original[type="checkbox"]');
    const letters = option.querySelectorAll(':scope > .el-checkbox__label > .letterSort');
    const texts = option.querySelectorAll(':scope > .el-checkbox__label > pre.preStyle');
    return !option.matches('label.el-checkbox') || isExplicitlyHidden(option) || inputs.length !== 1 ||
      letters.length !== 1 || texts.length !== 1 || !normalizedText(texts[0]!.textContent) ||
      normalizedText(letters[0]!.textContent) !== String.fromCharCode(65 + index);
  })) return null;
  return root;
}

export function isZhidaoNext(element: Element): boolean {
  return practiceDocument(element.ownerDocument) && element.matches(ZHIDAO_NEXT_SELECTOR) &&
    normalizedText(element.textContent) === '下一题' && !isExplicitlyHidden(element) &&
    Array.from(element.ownerDocument.querySelectorAll('.exam-test .questionContent')).filter(e => zhidaoPracticeRoot(e)).length === 1;
}

/** A whole knowledge-practice submit, never an exam or per-question grade.
 * This page saves its current selection when leaving the question or submitting;
 * the card can lag that selection. Other questions must already be saved. This
 * only authorizes the normal submit control, never confirms successful saving. */
export function resolveZhidaoPracticeSubmit(document: Document): HTMLElement | null {
  const reading=readZhidaoPractice(document);
  if(!reading)return null;
  const root = Array.from(document.querySelectorAll('.exam-test .questionContent')).find(e => zhidaoPracticeRoot(e));
  if (!root) return null;
  const currentSelected = zhidaoRadioRoot(root)
    ? Array.from(root.querySelectorAll(':scope > ul.radio-view >li.clearfix')).filter(zhidaoSelected).length === 1
    : Array.from(root.querySelectorAll<HTMLInputElement>('.checkbox-view input.el-checkbox__original[type="checkbox"]')).some(e => e.checked);
  if(reading.questions.some(q=>!q.answered && !(q.number===reading.current && currentSelected)))return null;
  const buttons=Array.from(document.querySelectorAll<HTMLElement>(ZHIDAO_SUBMIT_SELECTOR)).filter(e=>
    !isExplicitlyHidden(e)&&normalizedText(e.textContent)==='提交作业'&&!e.hasAttribute('disabled')&&e.getAttribute('aria-disabled')!=='true');
  return buttons.length===1?buttons[0]!:null;
}

export function zhidaoSelected(element: Element): boolean {
  return isZhidaoChoice(element) && Boolean(element.querySelector(':scope > i.checkIcon.checkedIcon'));
}

export function zhidaoStem(root: Element): string | null {
  return zhidaoPracticeRoot(root) === root
    ? `${normalizedText(root.querySelector(':scope > .questionName .questionTitle')!.textContent)}\n${normalizedText(root.querySelector(':scope > .questionName .centent-pre > pre.preStyle')!.textContent)}` : null;
}
