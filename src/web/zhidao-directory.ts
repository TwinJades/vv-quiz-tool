import { isExplicitlyHidden, normalizedText } from './dom-utils';

/** Observed AI smart-course knowledge cards, not executable learning tasks.
 * A card can contain a video and documents; study progress and mastery differ. */
export interface ZhidaoDirectoryReading {
  course_id: string;
  context_id: string;
  complete: false;
  modules: Array<{ id: string; title: string }>;
  points: Array<{
    id: string; module_id: string; title: string; order: number;
    study_percent: number | null; mastery_percent: number | null;
  }>;
  diagnostics: string[];
}

function visible(element: Element): boolean {
  if (isExplicitlyHidden(element)) return false;
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (style?.opacity === '0' || style?.visibility === 'collapse') return false;
  }
  return true;
}

function unique(root: Element, selector: string): HTMLElement | null {
  const matches = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(visible);
  return matches.length === 1 ? matches[0]! : null;
}

function percentage(text: string): number | null {
  const match = /^(\d+(?:\.\d+)?)\s*%$/.exec(normalizedText(text));
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

/** Reads only public DOM identities and rendered labels observed on 2026-10-04.
 * No page state, hidden values, navigation or completion inference. */
export function readZhidaoDirectory(document: Document): ZhidaoDirectoryReading | null {
  const url = new URL(document.location.href);
  if (url.origin !== 'https://ai-smart-course-student-pro.zhihuishu.com') return null;
  const path = /^\/singleCourse\/knowledgeStudy\/(\d+)\/(\d+)\/?$/.exec(url.pathname);
  if (!path) return null;
  const roots = Array.from(document.querySelectorAll<HTMLElement>('.knowledge .knowledge-content')).filter(visible);
  if (roots.length !== 1) return null;
  const reading: ZhidaoDirectoryReading = {
    course_id: path[1]!, context_id: path[2]!, complete: false, modules: [], points: [],
    diagnostics: ['仅记录已加载知识点；目录完整性、资源类型、锁定状态及测验规则尚待核对。',
      '学习进度与掌握度独立；不能据此确认视频结束、测验提交或整门课程完成。'],
  };
  const ids = new Set<string>();
  for (const module of Array.from(roots[0]!.children).filter(visible)) {
    const moduleId = /^knowledgeItem-(\d+)$/.exec(module.id)?.[1];
    const headings = Array.from(module.children).filter(e => e.matches('.content-list-title') && visible(e));
    if (!moduleId || headings.length !== 1 || reading.modules.some(m => m.id === moduleId)) {
      reading.diagnostics.push('知识模块身份或标题无法唯一确认。'); continue;
    }
    reading.modules.push({ id: moduleId, title: normalizedText((headings[0] as HTMLElement).innerText).replace(/^知识模块\s*/, '') });
    for (const card of Array.from(module.querySelectorAll<HTMLElement>('.item-content[knowledgeid]')).filter(visible)) {
      const id = card.getAttribute('knowledgeid') ?? '';
      const title = unique(card, '.item-title');
      if (!/^\d+$/.test(id) || card.id !== `knowledgeId-${id}` || ids.has(id) || !title?.innerText.trim()) {
        reading.diagnostics.push('知识点身份、标题重复或缺失。'); continue;
      }
      ids.add(id);
      const study = unique(card, '.item-bottom .bottom-text');
      const mastery = unique(card, '.item-top-right');
      reading.points.push({ id, module_id: moduleId, title: normalizedText(title.innerText), order: reading.points.length,
        study_percent: study && /^学习进度\s*/.test(normalizedText(study.innerText))
          ? percentage(normalizedText(study.innerText).replace(/^学习进度\s*/, '')) : null,
        mastery_percent: mastery && /掌握度/.test(mastery.innerText)
          ? percentage(unique(mastery, '.el-progress__text')?.innerText ?? '') : null });
    }
  }
  if (!reading.points.length) reading.diagnostics.push('未找到已加载知识点。');
  return reading;
}
