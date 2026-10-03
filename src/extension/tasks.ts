import type { ExtensionRequest, TaskPanelSnapshot } from "./messages";
import { requestCurrentWebsite } from "./website-access";

const tasks = document.querySelector<HTMLElement>("#tasks")!;
const errorText = document.querySelector<HTMLElement>("#error")!;
const limitInput = document.querySelector<HTMLInputElement>("#concurrency")!;
let refreshing = false;
let lastRenderMarker = "";
let port: chrome.runtime.Port;

function connect(): void {
  port = chrome.runtime.connect({ name: "vv-tasks" });
  port.onDisconnect.addListener(() => { window.setTimeout(connect, 500); });
}

async function send<T>(request: ExtensionRequest): Promise<T> {
  const response = await chrome.runtime.sendMessage(request) as { ok: boolean; result: T; error?: string };
  if (!response.ok) throw new Error(response.error || "任务操作失败");
  return response.result;
}

function text(tag: string, value: string, className = ""): HTMLElement {
  const element = document.createElement(tag);
  element.textContent = value;
  element.className = className;
  return element;
}

function action(label: string, disabled: boolean, run: () => Promise<unknown>): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener("click", () => {
    button.disabled = true;
    void run().then(async () => { errorText.textContent = ""; await refresh(); }).catch(error => {
      errorText.textContent = String(error.message || error);
      button.disabled = disabled;
    });
  });
  return button;
}

async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const state = await send<TaskPanelSnapshot>({ type: "VV_GET_TASKS" });
    document.querySelector("#queue")!.textContent = `运行 ${state.running.length} 场 · 排队 ${state.queued.length} 场`;
    if (document.activeElement !== limitInput) limitInput.value = String(state.concurrency);
    const marker = JSON.stringify({ ...state, tasks: state.tasks.map(task => ({ ...task, snapshot: { ...task.snapshot, timings: undefined, steps: undefined } })) });
    if (marker === lastRenderMarker) return;
    lastRenderMarker = marker;
    const cards = state.tasks.map(task => {
      const { snapshot, tab_id: tabId } = task;
      const terminal = ["COMPLETE", "FAILED", "CANCELLED"].includes(snapshot.state);
      const queuedPosition = state.queued.indexOf(tabId);
      const card = document.createElement("article");
      card.className = "panel task";
      card.dataset.paused = String(snapshot.state === "PAUSED" || snapshot.state === "FAILED");
      card.append(text("h2", task.title), text("p", task.url || `标签 ${tabId}`, "muted"));
      card.append(text("p", `${snapshot.state}${queuedPosition >= 0 ? ` · 排队第 ${queuedPosition + 1} 场` : ""}`, "state"));
      if (!terminal && snapshot.timer_remaining_seconds !== null && snapshot.timer_remaining_seconds !== undefined) card.append(text("p", `剩余约 ${snapshot.timer_remaining_seconds} 秒${snapshot.timer_remaining_seconds <= 60 ? " · 优先收尾" : ""}`, "muted"));
      card.append(text("p", `${snapshot.strategy === "supervised" ? "监督自动" : "无人值守"} · ${task.provider_name} · ${snapshot.model_id}`));
      card.append(text("p", `已答 ${snapshot.progress.answered}/${snapshot.progress.total} · 猜答 ${snapshot.progress.guessed} · 重试 ${snapshot.progress.retried} · 跳过 ${snapshot.progress.skipped} · 失败 ${snapshot.progress.failed} · 调用 ${snapshot.model_calls.used}/${snapshot.model_calls.limit}`));
      if (snapshot.notice) card.append(text("p", snapshot.notice, "notice"));
      if(snapshot.course){
        const course=snapshot.course;
        card.append(text('p',`${course.title} · ${course.phase} · 仅本次选定的视频与关联测验`));
        card.append(text('p',`预计剩余播放时间：${course.estimate_seconds===null?'暂无法估计':course.estimate_seconds+'秒'}${course.estimate_frozen?'（冻结）':''}；不含未知缓冲、答题与平台同步。`,'muted'));
        card.append(text('p',`视频结束 ${course.video.ended?'已确认':'未确认'} · 平台记录 ${course.video.progress_recorded?'已确认':'未确认'}`));
        for(const item of course.results)card.append(text('p',`${item.kind==='video_popup'?'弹题':'课时/章节测验'} · ${item.result.status} · 提交 ${item.result.submission_confirmed?'已确认':'未确认'} · 得分 ${item.result.visible_score??'未提供'}`));
      }
      if (snapshot.summary) card.append(text("p", `本场总结：${snapshot.summary.status} · 得分 ${snapshot.summary.visible_score || "网站未提供"} · ${snapshot.summary.stop_reason || "测验结束"}`));
      const visual = snapshot.summary?.visual_metrics ?? snapshot.visual_metrics;
      if (visual?.coordinate_attempts || visual?.stale_frame_rejections) card.append(text("p", `视觉操作：坐标尝试 ${visual.coordinate_attempts} · 点击已发送 ${visual.coordinate_clicks} · 截图复核 ${visual.verification_reads} · 验证失败 ${visual.verification_failures} · 拒绝过期截图 ${visual.stale_frame_rejections}`, "muted"));
      const actions = document.createElement("div");
      actions.className = "task-actions";
      actions.append(
        action("回到网站", false, async () => { const tab = await chrome.tabs.update(tabId, { active: true }); if (tab) await chrome.windows.update(tab.windowId, { focused: true }); }),
        action("暂停", terminal || snapshot.state === "PAUSED", () => send({ type: "VV_PAUSE_SESSION", tab_id: tabId })),
        action("继续", !task.resumable || snapshot.state !== "PAUSED", async () => {
          await requestCurrentWebsite(tabId);
          return send({ type: "VV_RESUME_SESSION", tab_id: tabId });
        }),
        action("停止", terminal, () => send({ type: "VV_STOP_SESSION", tab_id: tabId })),
        action("清除本场", !terminal && snapshot.state !== "PAUSED", () => send({ type: "VV_CLEAR_SESSION", tab_id: tabId })),
        action(snapshot.strategy === "supervised" ? "切换无人值守" : "切换监督自动", terminal, () => send({ type: "VV_SWITCH_STRATEGY", tab_id: tabId, strategy: snapshot.strategy === "supervised" ? "unattended" : "supervised" })),
      );
      card.append(actions);
      if (!task.resumable && snapshot.state === "PAUSED") card.append(text("p", "浏览器已回收这场运行。请清除状态后从网站重新启动。", "muted"));
      return card;
    });
    tasks.replaceChildren(...(cards.length ? cards : [text("p", "尚无测验任务。请在网站标签中启动 VV。", "muted")]));
  } catch (error) { errorText.textContent = String((error as Error).message || error); }
  finally { refreshing = false; }
}

document.querySelector("#apply")!.addEventListener("click", () => {
  void send({ type: "VV_SET_CONCURRENCY", limit: Number(limitInput.value) }).then(() => { errorText.textContent = ""; return refresh(); }).catch(error => { errorText.textContent = String(error.message || error); });
});
connect();
void refresh();
window.setInterval(() => { try { port.postMessage({ heartbeat: true }); } catch {} void refresh(); }, 1000);
