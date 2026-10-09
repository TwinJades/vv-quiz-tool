import { normalizedText } from './dom-utils';
import { isVisibleZhidaoPlayerElement, readZhidaoPlayer, type ZhidaoPlayerReading } from './zhidao-player';

export type ZhidaoNormalHover = (element: HTMLElement, signal: AbortSignal) => Promise<void>;

/** A lease for one currently observed resource and media element. It is local
 * to this document, expires on resource/navigation changes, and is not a task
 * completion record or a stable platform resource ID. The caller still owns
 * website permission, course scope, interaction epoch and course rule checks. */
export class ZhidaoPlayerControls {
  readonly #video: HTMLVideoElement;
  readonly #root: HTMLElement;
  readonly #card: HTMLElement;
  readonly #basis: string;
  readonly #expected: ZhidaoPlayerReading;
  #closed = false;
  #buffering = false;
  readonly #events: Array<[string, EventListener]> = [];

  constructor(private readonly document: Document, expected: ZhidaoPlayerReading,
    private readonly normalHover?: ZhidaoNormalHover) {
    const current = readZhidaoPlayer(document);
    if (!current || Date.now() - expected.observed_at < 0 || Date.now() - expected.observed_at > 5000 ||
      current.course_id !== expected.course_id || current.point_id !== expected.point_id ||
      current.context_id !== expected.context_id || current.element_id !== expected.element_id ||
      current.active_resource_summary !== expected.active_resource_summary) throw new Error('播放器观察已过期或资源身份已改变。');
    this.#expected = structuredClone(expected);
    const roots = document.querySelectorAll<HTMLElement>('.videoNameBox.able-player-container > .video-js');
    const cards = document.querySelectorAll<HTMLElement>('.resources-section .resources-list > .basic-info-video-card-container.active');
    if (roots.length !== 1 || cards.length !== 1) throw new Error('播放器或活动资源不唯一。');
    this.#root = roots[0]!;
    this.#card = cards[0]!;
    const media = this.#root.querySelectorAll<HTMLVideoElement>(':scope > video.vjs-tech');
    if (media.length !== 1 || media[0]!.id !== expected.element_id) throw new Error('媒体元素身份已改变。');
    this.#video = media[0]!;
    this.#basis = this.resourceBasis(this.#card);
    this.assertCurrent();
    for (const event of ['waiting', 'stalled']) this.listen(event, () => { this.#buffering = true; });
    for (const event of ['playing', 'canplay', 'ended']) this.listen(event, () => { this.#buffering = false; });
  }

  private listen(event: string, listener: EventListener): void {
    this.#video.addEventListener(event, listener); this.#events.push([event, listener]);
  }
  private resourceBasis(card: HTMLElement): string {
    if (!isVisibleZhidaoPlayerElement(card)) throw new Error('当前资源卡片不可见。');
    const section = card.closest('.resources-section');
    const titles = section?.querySelectorAll<HTMLElement>(':scope > .resources-detail-title');
    const infos = card.querySelectorAll<HTMLElement>(':scope > .video-info > div:not(.finished-icon)');
    const icons = card.querySelectorAll(':scope > .video-wrap > .icon-box.video');
    const group = normalizedText(titles?.length === 1 && isVisibleZhidaoPlayerElement(titles[0]!) ? titles[0]!.innerText : '');
    const info = normalizedText(infos.length === 1 && isVisibleZhidaoPlayerElement(infos[0]!) ? infos[0]!.innerText : '');
    if (!['必学资源', '选学资源'].includes(group) || !info || icons.length !== 1 || !/\s\d{2}:\d{2}:\d{2}$/.test(info))
      throw new Error('当前视频资源分区、标题或时长无法确认。');
    return JSON.stringify([group, info]);
  }
  private assertCurrent(signal?: AbortSignal): ZhidaoPlayerReading {
    signal?.throwIfAborted();
    const current = readZhidaoPlayer(this.document);
    if (this.#closed || !this.#root.isConnected || !this.#video.isConnected || !this.#card.isConnected || !current ||
      current.course_id !== this.#expected.course_id || current.point_id !== this.#expected.point_id ||
      current.context_id !== this.#expected.context_id || current.element_id !== this.#video.id ||
      this.#root.querySelector(':scope > video.vjs-tech') !== this.#video || !this.#card.classList.contains('active') ||
      this.resourceBasis(this.#card) !== this.#basis ||
      (this.#expected.duration !== null && current.duration !== this.#expected.duration)) throw new Error('当前课程、资源或媒体已改变，停止播放器操作。');
    const cards = Array.from(this.document.querySelectorAll<HTMLElement>('.resources-section .resources-list > .basic-info-video-card-container')).filter(isVisibleZhidaoPlayerElement);
    const active = cards.filter(card => card.classList.contains('active'));
    if (active.length !== 1 || active[0] !== this.#card) throw new Error('活动视频资源已改变或不唯一。');
    const matching = cards.filter(card => {
      try { return this.resourceBasis(card) === this.#basis; } catch { return false; }
    });
    if (matching.length !== 1 || matching[0] !== this.#card) throw new Error('当前视频资源身份存在歧义。');
    return current;
  }
  snapshot(): ZhidaoPlayerReading & { buffering: boolean; visible: boolean } {
    const reading=this.assertCurrent();
    if(!reading.paused&&!reading.ended&&(reading.rate===null||!Number.isFinite(reading.rate)||reading.rate<=0))
      throw new Error('实际播放速度无效。');
    return { ...reading, buffering: this.#buffering || this.#video.readyState < 3,
      visible: this.document.visibilityState === 'visible' };
  }
  private async reveal(signal: AbortSignal): Promise<void> {
    this.assertCurrent(signal);
    // The observed custom player normally reveals controls on mousemove.
    // No CSS/style mutation, OS pointer movement or forced page visibility.
    this.#root.dispatchEvent(new this.document.defaultView!.MouseEvent('mousemove', { bubbles: true }));
    await this.confirm(reading => reading.controls_visible, signal);
  }
  private control(selector: string, signal: AbortSignal): HTMLElement {
    const current = this.assertCurrent(signal);
    if (!current.controls_visible) throw new Error('正常播放器控件尚未显示。');
    const controls = this.#root.querySelectorAll<HTMLElement>(selector);
    if (controls.length !== 1 || !isVisibleZhidaoPlayerElement(controls[0]!) || controls[0]!.hasAttribute('disabled') || controls[0]!.getAttribute('aria-disabled') === 'true' ||
      this.document.defaultView?.getComputedStyle(controls[0]!).pointerEvents === 'none')
      throw new Error('正常播放器控件不可用或不唯一。');
    return controls[0]!;
  }
  private async confirm(predicate: (reading: ZhidaoPlayerReading) => boolean, signal: AbortSignal): Promise<void> {
    const until = Date.now() + 1500;
    while (Date.now() <= until) {
      if (predicate(this.assertCurrent(signal))) return;
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason ?? new DOMException('Cancelled', 'AbortError')); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 50);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    }
    throw new Error('播放器操作后的实际状态尚未确认。');
  }
  async mute(signal: AbortSignal): Promise<void> {
    const before = this.assertCurrent(signal);
    if (before.muted || before.volume === 0) return;
    await this.reveal(signal);
    const button = this.control(':scope > .controlsBar > .volumeBox > .volumeIcon', signal);
    const current = this.assertCurrent(signal);
    if (current.muted || current.volume === 0) return;
    button.click();
    await this.confirm(reading => reading.muted || reading.volume === 0, signal);
  }
  async pause(signal: AbortSignal): Promise<void> {
    if (this.assertCurrent(signal).paused) return;
    await this.reveal(signal);
    // The same normal toggle changes class with Vue's playback state.
    const button = this.control(':scope > .controlsBar > .playButton, :scope > .controlsBar > .pauseButton', signal);
    if (this.assertCurrent(signal).paused) return;
    button.click();
    await this.confirm(reading => reading.paused, signal);
  }
  async highestAllowedSpeed(allowed: boolean | null, signal: AbortSignal): Promise<void> {
    const before = this.assertCurrent(signal);
    if(before.rate===null||!Number.isFinite(before.rate)||before.rate<=0)throw new Error('实际播放速度无效。');
    if(allowed===false&&before.rate!==1)throw new Error('课程不允许倍速，请调整外部加速插件。');
  }
  async play(signal: AbortSignal): Promise<void> {
    await this.mute(signal);
    const before = this.assertCurrent(signal);
    if (before.rate === null || !Number.isFinite(before.rate)||before.rate<=0) throw new Error('实际播放速度无效。');
    if (before.ended) throw new Error('视频已结束，禁止把播放控件当重播。');
    if (!before.paused) return;
    await this.reveal(signal);
    const button = this.control(':scope > .controlsBar > .playButton, :scope > .controlsBar > .pauseButton', signal);
    const current = this.assertCurrent(signal);
    if (!(current.muted || current.volume === 0) || current.rate === null || !Number.isFinite(current.rate)||current.rate<=0 || current.ended)
      throw new Error('恢复播放前静音、倍速或结束状态已改变。');
    if (!current.paused) return;
    button.click();
    await this.confirm(reading => !reading.paused && !reading.ended && (reading.muted || reading.volume === 0) &&
      reading.rate !== null && Number.isFinite(reading.rate)&&reading.rate>0, signal);
  }
  close(): void {
    this.#closed = true;
    for (const [event, listener] of this.#events) this.#video.removeEventListener(event, listener);
    this.#events.length = 0;
  }
}
