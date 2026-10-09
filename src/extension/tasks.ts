import type { ExtensionRequest, TaskPanelSnapshot } from "./messages";
import { requestCurrentWebsite } from "./website-access";
import { hasUiTranslation, initializeUiLanguage, showNotice, stateLabel, t } from './ui-language';

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
  element.textContent = hasUiTranslation(value) ? t(value) : value;
  element.className = className;
  return element;
}

function action(label: string, disabled: boolean, run: () => Promise<unknown>): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = t(label);
  button.disabled = disabled;
  button.addEventListener("click", () => {
    button.disabled = true;
    void run().then(async () => { showNotice(errorText, ""); await refresh(); }).catch(error => {
      showNotice(errorText,String(error.message || error));
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
    document.querySelector("#queue")!.textContent = t('运行 {{running}} 场 · 排队 {{queued}} 场',{running:state.running.length,queued:state.queued.length});
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
      card.append(text("h2", task.title), text("p", task.url || t('标签 {{id}}',{id:tabId}), "muted"));
      card.append(text("p", `${stateLabel(snapshot.state)}${queuedPosition >= 0 ? ' · '+t('排队第 {{position}} 场',{position:queuedPosition+1}) : ""}`, "state"));
      if (!terminal && snapshot.timer_remaining_seconds !== null && snapshot.timer_remaining_seconds !== undefined) card.append(text("p", t('剩余约 {{seconds}} 秒',{seconds:snapshot.timer_remaining_seconds})+(snapshot.timer_remaining_seconds <= 60 ? ' · '+t('优先收尾') : ''), "muted"));
      card.append(text("p", `${task.provider_name} · ${snapshot.model_id}`));
      const progressValues={...snapshot.progress,used:snapshot.model_calls.used,limit:snapshot.model_calls.limit};
      card.append(text("p", t(snapshot.practice?'新提交练习 {{answered}}/{{total}} · 已有记录/无练习 {{skipped}} · 调用 {{used}}/{{limit}}':'已答 {{answered}}/{{total}} · 猜答 {{guessed}} · 重试 {{retried}} · 跳过 {{skipped}} · 失败 {{failed}} · 调用 {{used}}/{{limit}}',progressValues)));
      if (snapshot.notice) { const notice=text('p','','notice'); notice.id='notice-'+tabId; card.append(notice); showNotice(notice,snapshot.notice); }
      if(snapshot.course){
        const course=snapshot.course;
        const current=course.checkpoint?.children.find(task=>task.id===course.current_task_id)??course.tasks.find(task=>task.id===course.current_task_id);
        card.append(text('p',`${course.title} · ${stateLabel(course.phase)} · ${t('仅本次选定的视频与关联测验')}`));
        if(current)card.append(text('p',t('当前资源：{{title}}',{title:current.title})));
        card.append(text('p',t('预计剩余播放时间：{{estimate}}{{frozen}}；不含未知缓冲、答题与平台同步。',{estimate:course.estimate_seconds===null?t('暂无法估计'):t('{{seconds}}秒',{seconds:course.estimate_seconds}),frozen:course.estimate_frozen?t('（冻结）'):''}),'muted'));
        card.append(text('p',t('视频结束 {{ended}} · 平台记录 {{recorded}}',{ended:t(course.video.ended?'已确认':'未确认'),recorded:t(course.video.progress_recorded?'已确认':'未确认')})));
        if(course.video.rate!==undefined)card.append(text('p',t('实际倍速 {{rate}}x · 速度由外部插件设置',{rate:course.video.rate??t('未确认')}),'muted'));
        for(const issue of course.issues??[])card.append(text('p',`${issue.title} · ${issue.reason}`,'notice'));
        for(const item of course.results)card.append(text('p',t('{{kind}} · {{status}} · 提交 {{submission}} · 得分 {{score}}',{kind:t(item.kind==='video_popup'?'弹题':'课时/章节测验'),status:stateLabel(item.result.status),submission:t(item.result.submission_confirmed?'已确认':'未确认'),score:item.result.visible_score??t('未提供')})));
      }
      if(snapshot.practice){
        card.append(text('p',`${snapshot.practice.title} · ${stateLabel(snapshot.practice.phase)} · ${t('仅选定知识点练习')}`));
        card.append(text('p','视频、PPT、独立作业与期末考试未纳入；答对数不等于掌握度或及格。','muted'));
        for(const item of snapshot.practice.results)card.append(text('p',`${item.title} · ${t(item.status==='submitted'?'新提交已确认':item.status==='existing_record'?'保留已有作答记录':'页面明确无练习')}${item.score?' · '+item.score:''}`));
      }
      if (snapshot.summary) {
        card.append(text('p',t('本场总结：{{status}} · 得分 {{score}} · {{reason}}',{status:stateLabel(snapshot.summary.status),score:snapshot.summary.visible_score||t('网站未提供'),reason:snapshot.summary.stop_reason?'':t('测验结束')})));
        if(snapshot.summary.stop_reason){const reason=text('p',''); reason.id='reason-'+tabId; card.append(reason);showNotice(reason,snapshot.summary.stop_reason);}
      }
      const visual = snapshot.summary?.visual_metrics ?? snapshot.visual_metrics;
      if (visual?.coordinate_attempts || visual?.stale_frame_rejections) card.append(text("p", t('视觉操作：坐标尝试 {{attempts}} · 点击已发送 {{clicks}} · 截图复核 {{reads}} · 验证失败 {{failures}} · 拒绝过期截图 {{stale}}',{attempts:visual.coordinate_attempts,clicks:visual.coordinate_clicks,reads:visual.verification_reads,failures:visual.verification_failures,stale:visual.stale_frame_rejections}), "muted"));
      const actions = document.createElement("div");
      actions.className = "task-actions";
      if(task.saved_session_id){
        actions.append(action('打开课程',false,()=>send({type:'VV_OPEN_SAVED_COURSE',session_id:task.saved_session_id!})));
        actions.append(action('清除本场',false,()=>send({type:'VV_CLEAR_SAVED_COURSE',session_id:task.saved_session_id!})));
        card.append(actions,text('p','打开课程并登录后，在VV中点击继续。','muted'));return card;
      }
      actions.append(
        action("回到网站", false, async () => { const tab = await chrome.tabs.update(tabId, { active: true }); if (tab) await chrome.windows.update(tab.windowId, { focused: true }); }),
        action("暂停", terminal || snapshot.state === "PAUSED", () => send({ type: "VV_PAUSE_SESSION", tab_id: tabId })),
        action("继续", !task.resumable || snapshot.state !== "PAUSED", async () => {
          await requestCurrentWebsite(tabId);
          return send({ type: "VV_RESUME_SESSION", tab_id: tabId });
        }),
        action("停止", terminal, () => send({ type: "VV_STOP_SESSION", tab_id: tabId })),
        action("清除本场", !terminal && snapshot.state !== "PAUSED", () => send({ type: "VV_CLEAR_SESSION", tab_id: tabId })),
      );
      card.append(actions);
      if (!task.resumable && snapshot.state === "PAUSED") card.append(text("p", "浏览器已回收这场运行。请清除状态后从网站重新启动。", "muted"));
      return card;
    });
    tasks.replaceChildren(...(cards.length ? cards : [text("p", "尚无测验任务。请在网站标签中启动 VV。", "muted")]));
  } catch (error) { showNotice(errorText,String((error as Error).message || error)); }
  finally { refreshing = false; }
}

document.querySelector("#apply")!.addEventListener("click", () => {
  void send({ type: "VV_SET_CONCURRENCY", limit: Number(limitInput.value) }).then(() => { showNotice(errorText, ""); return refresh(); }).catch(error => { showNotice(errorText,String(error.message || error)); });
});
connect();
void initializeUiLanguage(()=>{lastRenderMarker='';return refresh();});
window.setInterval(() => { try { port.postMessage({ heartbeat: true }); } catch {} void refresh(); }, 1000);
