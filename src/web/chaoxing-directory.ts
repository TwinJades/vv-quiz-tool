import { isExplicitlyHidden, normalizedText } from './dom-utils';

export interface ChaoxingDirectoryReading {
  course_id: string | null;
  complete: false;
  lessons: Array<{ id: string; title: string; order: number; observed_markers: string[] }>;
  diagnostics: string[];
}

/** Only the observed studentcourse frame; rows do not reveal video/quiz tasks.
 * Keep raw status markers until incomplete and completed states are verified. */
export function readChaoxingDirectory(document: Document): ChaoxingDirectoryReading | null {
  const url = new URL(document.location.href);
  if (url.origin !== 'https://mooc2-ans.chaoxing.com' || url.pathname !== '/mooc2-ans/mycourse/studentcourse') return null;
  const values = ['courseid', 'courseId'].map(key => url.searchParams.get(key)).filter((value): value is string => Boolean(value && /^\d+$/.test(value)));
  const courseId = values.length > 0 && new Set(values).size === 1 ? values[0]! : null;
  const reading: ChaoxingDirectoryReading = { course_id: courseId, complete: false, lessons: [], diagnostics: [
    '仅记录已加载课时目录；任务类型、开始状态及完成条件需要课时页证据。',
    '目录图标不单独证明视频结束或测验提交；已结课样本不能用于新进度验收。',
  ] };
  if (!courseId) reading.diagnostics.push('当前frame无法唯一确认公开课程ID。');
  const seen = new Set<string>();
  for (const row of Array.from(document.querySelectorAll<HTMLElement>('.chapter_item[id]')).filter(e => !isExplicitlyHidden(e))) {
    const id = /^cur(\d+)$/.exec(row.id)?.[1];
    const titles = Array.from(row.querySelectorAll<HTMLElement>(':scope > .catalog_title > .catalog_name > a.clicktitle')).filter(e => !isExplicitlyHidden(e));
    if (!id || seen.has(id) || titles.length !== 1 || !titles[0]!.innerText.trim()) {
      reading.diagnostics.push('课时公开ID或标题无法唯一确认。'); continue;
    }
    seen.add(id);
    reading.lessons.push({ id, title: normalizedText(titles[0]!.innerText), order: reading.lessons.length,
      observed_markers: Array.from(row.querySelectorAll('.catalog_task .catalog_state')).filter(e => !isExplicitlyHidden(e))
        .flatMap(e => Array.from(e.classList)).filter(c => /^[a-zA-Z0-9_-]{1,64}$/.test(c)) });
  }
  if (!reading.lessons.length) reading.diagnostics.push('当前目录没有已加载的课时。');
  return reading;
}
