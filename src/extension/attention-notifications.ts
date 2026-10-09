import type { SessionRuntimeSnapshot } from "../core";
import { describeNotice, t } from './ui-language';
import type { UiLanguage } from './ui-language';

export interface AttentionNotice { title: string; message: string }

export class SessionAttentionNotifications {
  #lastAttentionState: string | null = null;
  #closeOutNotified = false;

  next(snapshot: Pick<SessionRuntimeSnapshot, "state" | "strategy" | "notice">, language:UiLanguage='zh-CN'): AttentionNotice | null {
    if (!["PAUSED", "FAILED"].includes(snapshot.state)) this.#lastAttentionState = null;
    if (snapshot.state === "CLOSE_OUT") {
      if (this.#closeOutNotified) return null;
      this.#closeOutNotified = true;
      return { title:t("VV 正在收尾",{},language), message:t("剩余时间已进入最后 60 秒，VV 正在优先处理未答题并预留提交时间。可在任务面板随时暂停。",{},language) };
    }
    if (!["PAUSED", "FAILED"].includes(snapshot.state) || this.#lastAttentionState === snapshot.state) return null;
    this.#lastAttentionState = snapshot.state;
    return {
      title: 'VV '+t(snapshot.state === "FAILED" ? '运行失败' : '运行已暂停',{},language),
      message: snapshot.notice ? describeNotice(snapshot.notice,language).text : t('打开 VV 查看当前会话。',{},language),
    };
  }
}
