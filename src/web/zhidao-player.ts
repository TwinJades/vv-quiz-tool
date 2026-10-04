import { isExplicitlyHidden, normalizedText } from './dom-utils';

export interface ZhidaoPlayerReading {
  course_id: string;
  point_id: string;
  context_id: string;
  /** A generated DOM ID is not a stable platform video/task identity. */
  element_id: string;
  resource_id: null;
  observed_at: number;
  position: number | null;
  duration: number | null;
  rate: number | null;
  paused: boolean;
  ended: boolean;
  seeking: boolean;
  muted: boolean;
  volume: number;
  ready_state: number;
  controls_visible: boolean;
  speed_menu_visible: boolean;
  speed_options: Array<{ rate: number; enabled: boolean }>;
  active_resource_summary: string | null;
  diagnostics: string[];
}

export function isVisibleZhidaoPlayerElement(element: Element): boolean {
  if (isExplicitlyHidden(element)) return false;
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (style?.opacity === '0' || style?.visibility === 'collapse') return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
const visible = isVisibleZhidaoPlayerElement;

/** Read normal media state and currently rendered normal menu choices only.
 * No hover, click, rate assignment, seeking, script/page-state access or token
 * reads. The generated player DOM ID never becomes a learning task ID. */
export function readZhidaoPlayer(document: Document): ZhidaoPlayerReading | null {
  if (document.location.origin !== 'https://ai-smart-course-student-pro.zhihuishu.com') return null;
  const path = /^\/learnPage\/(\d+)\/(\d+)\/(\d+)\/?$/.exec(document.location.pathname);
  if (!path) return null;
  const roots = Array.from(document.querySelectorAll<HTMLElement>('.videoNameBox.able-player-container > .video-js')).filter(visible);
  if (roots.length !== 1) return null;
  const root = roots[0]!;
  const videos = Array.from(root.querySelectorAll<HTMLVideoElement>(':scope > video.vjs-tech')).filter(visible);
  if (videos.length !== 1 || !videos[0]!.id) return null;
  const video = videos[0]!;
  const bars = Array.from(root.querySelectorAll<HTMLElement>(':scope > .controlsBar')).filter(visible);
  const menus = bars.length === 1 ? Array.from(bars[0]!.querySelectorAll<HTMLElement>(':scope > .speedBox > .speedList')).filter(visible) : [];
  const choices = menus.length === 1 ? Array.from(menus[0]!.querySelectorAll<HTMLElement>(':scope > .speedTab')).filter(visible) : [];
  const options: ZhidaoPlayerReading['speed_options'] = [];
  for (const choice of choices) {
    const value = choice.getAttribute('rate')?.trim() ?? '';
    const label = /^X\s+(\d+(?:\.\d+)?)$/.exec(normalizedText(choice.textContent));
    if (!/^\d+(?:\.\d+)?$/.test(value) || !label || Number(label[1]) !== Number(value) || Number(value) <= 0 ||
      options.some(option => option.rate === Number(value))) return null;
    options.push({ rate:Number(value), enabled:!choice.hasAttribute('disabled') && choice.getAttribute('aria-disabled') !== 'true' &&
      !choice.classList.contains('disabled') && document.defaultView?.getComputedStyle(choice).pointerEvents !== 'none' });
  }
  const active = Array.from(document.querySelectorAll<HTMLElement>('.resources-section .resources-list > .basic-info-video-card-container.active')).filter(visible);
  const summaries = active.length === 1 ? Array.from(active[0]!.querySelectorAll<HTMLElement>(':scope > .video-info')).filter(visible) : [];
  return { course_id:path[1]!, point_id:path[2]!, context_id:path[3]!, element_id:video.id, resource_id:null, observed_at:Date.now(),
    position:Number.isFinite(video.currentTime) ? video.currentTime : null,
    duration:Number.isFinite(video.duration) ? video.duration : null,
    rate:Number.isFinite(video.playbackRate) && video.playbackRate > 0 ? video.playbackRate : null,
    paused:video.paused, ended:video.ended, seeking:video.seeking, muted:video.muted, volume:video.volume, ready_state:video.readyState,
    controls_visible:bars.length === 1, speed_menu_visible:menus.length === 1, speed_options:options,
    active_resource_summary:summaries.length === 1 ? normalizedText(summaries[0]!.innerText).slice(0,200) : null,
    diagnostics:['播放器状态和正常菜单只读资料；资源稳定身份、缓冲事件及平台完成记录尚未核对。',
      '隐藏或未展开倍速不读取，不从speedTab类名猜速度；菜单未展开不等于禁止倍速。'] };
}
