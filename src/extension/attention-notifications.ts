import type { SessionRuntimeSnapshot } from "../core";

export interface AttentionNotice { title: string; message: string }

export class SessionAttentionNotifications {
  #lastAttentionState: string | null = null;
  #closeOutNotified = false;

  next(snapshot: Pick<SessionRuntimeSnapshot, "state" | "strategy" | "notice">): AttentionNotice | null {
    if (!["PAUSED", "FAILED"].includes(snapshot.state)) this.#lastAttentionState = null;
    if (snapshot.state === "CLOSE_OUT") {
      if (snapshot.strategy !== "supervised" || this.#closeOutNotified) return null;
      this.#closeOutNotified = true;
      return { title: "VV 正在收尾", message: "剩余时间已进入最后 60 秒，VV 正在优先处理未答题并预留提交时间。可在任务面板随时暂停。" };
    }
    if (!["PAUSED", "FAILED"].includes(snapshot.state) || this.#lastAttentionState === snapshot.state) return null;
    this.#lastAttentionState = snapshot.state;
    return {
      title: snapshot.state === "FAILED" ? "VV session failed" : "VV session paused",
      message: snapshot.notice ?? "Open VV to review the session.",
    };
  }
}
