import { DomWebAdapter } from "../web/dom-adapter";
import type { ContentRequest, ContentResponse } from "./messages";
import { InteractionGuard } from "./interaction-guard";
import { captureVisualGeometry } from "../web/visual-geometry";
import { CoursePageAdapter, coursePlatform } from '../web/course-adapter';
import type { PlatformState } from '../core';
import { inspectCoursePage } from '../web/course-inspection';

declare global {
  interface Window {
    __vvContentInstalled?: boolean;
  }
}

if (!window.__vvContentInstalled) {
  window.__vvContentInstalled = true;
  const adapter = new DomWebAdapter(document);
  let coursePage: CoursePageAdapter | null = null;
  let scopedQuiz: { root: HTMLElement; adapter: DomWebAdapter } | null = null;
  let courseSubmit: {parentId:string;boundaryId:string;taskId:string;state:PlatformState;videoId:string|null}|null=null;
  const interaction = new InteractionGuard(document, target => adapter.isQuizInteractionTarget(target) ||
    Boolean(coursePage && target instanceof Element && target.closest('[data-course-catalog]')), binding => {
    void chrome.runtime.sendMessage({ type: "VV_USER_INTERACTION", session_id: binding.session_id, epoch: binding.epoch }).catch(() => {
      // Execution stays blocked locally even if the worker is unavailable.
    });
  });

  chrome.runtime.onMessage.addListener(
    (request: ContentRequest, _sender, sendResponse: (response: ContentResponse) => void) => {
      void (async () => {
        try {
          if(request.type==='VV_INSPECT_COURSE_PAGE'){sendResponse({ok:true,result:inspectCoursePage(document)});return;}
          if (request.type === 'VV_COURSE' || request.type === 'VV_COURSE_QUIZ') {
            const platform = coursePlatform(location.href);
            if (!platform) throw new Error('当前网站不是知到或学习通课程页面。');
            coursePage ??= new CoursePageAdapter(document, platform);
            const blocker = adapter.detectHardBlocker(); if (blocker) throw new Error(blocker);
            if (request.type === 'VV_COURSE') {
              const operation = request.request.operation;
              const preview = operation === 'catalog' && request.session_id === undefined;
              const pause = operation === 'pause';
              const signal = preview ? new AbortController().signal : pause && request.session_id && request.interaction_epoch && interaction.matches(request.session_id,request.interaction_epoch)
                ? new AbortController().signal : interaction.signal(request.session_id,request.interaction_epoch);
              signal.throwIfAborted();
              const result = await interaction.runAutomation(() => coursePage!.execute(request.request));
              signal.throwIfAborted();sendResponse({ok:true,result});return;
            }
            const signal = interaction.signal(request.parent_session_id,request.interaction_epoch);
            let root:HTMLElement;
            try { root=coursePage.quizRoot(request.course_id,request.task,request.boundary.kind); }
            catch(error){
              if(request.request.type==='VV_READ_STATE'&&request.boundary.kind==='video_popup'&&courseSubmit?.parentId===request.parent_session_id&&courseSubmit.boundaryId===request.boundary.id&&courseSubmit.taskId===request.task.id){
                const video=coursePage.video(request.course_id,request.task);
                if(video.video_id!==courseSubmit.videoId||video.popup)throw error;
                sendResponse({ok:true,result:{...courseSubmit.state,completed:!video.paused&&!video.buffering&&!video.seeking,feedback:null,can_retry:false,has_next:false,has_session_submit:false}});return;
              }
              throw error;
            }
            if(root.dataset.quizId !== request.boundary.id || request.boundary.task_id !== request.task.id)throw new Error('弹题/测验身份改变。');
            if(!scopedQuiz || scopedQuiz.root !== root){scopedQuiz?.adapter.release();scopedQuiz={root,adapter:new DomWebAdapter(document,undefined,root)};}
            const quiz=scopedQuiz.adapter;const inner=request.request;
            if(inner.type==='VV_WAIT_READY'){sendResponse({ok:true,result:await quiz.waitUntilReady(signal)});return;}
            if(inner.type==='VV_OBSERVE'){sendResponse({ok:true,result:await quiz.observeSession(inner.session_id,signal,'structured')});return;}
            if(inner.type==='VV_EXECUTE'){
              if(root.dataset.submissionConfirmed==='true'||root.dataset.remainingAttempts==='0'||root.dataset.requiresRewatch==='true' && root.dataset.feedback==='incorrect')throw new Error('测验已提交、次数耗尽或要求回看，禁止重复作答。');
              if(inner.plan.actions.some(a=>a.kind==='retry_question')&&root.dataset.retryAllowed!=='true')throw new Error('网站当前不允许重答。');
              const before=await quiz.readState(signal);
              const videoId=request.boundary.kind==='video_popup'?coursePage.video(request.course_id,request.task).video_id:null;
              const results=await interaction.runAutomation(()=>quiz.execute(inner.plan,inner.locator_map,signal));
              if(inner.plan.actions.some(a=>a.kind==='submit_question'||a.kind==='submit_session')&&results.every(r=>r.status==='succeeded'))courseSubmit={parentId:request.parent_session_id,boundaryId:request.boundary.id,taskId:request.task.id,state:before,videoId};
              sendResponse({ok:true,result:results});return;
            }
            if(inner.type==='VV_READ_STATE'){
              const result:PlatformState=await quiz.readState(signal);
              result.completed=root.dataset.submissionConfirmed==='true' && (request.boundary.kind!=='video_popup'||root.dataset.popupResolved==='true');
              result.can_retry=result.can_retry&&request.boundary.rules.retry_allowed===true&&request.boundary.rules.requires_rewatch===false;
              sendResponse({ok:true,result});return;
            }
            if(inner.type==='VV_READ_TIMER'){sendResponse({ok:true,result:request.boundary.kind==='video_popup'?null:await quiz.readTimer(signal)});return;}
            if(inner.type==='VV_RESOLVE_MEDIA'){
              sendResponse({ok:true,result:inner.temporary_handles.flatMap(handle=>{const source=quiz.resolveMediaSource(handle);return source?[{temporary_handle:handle,...source}]:[];})});return;
            }
            throw new Error('课程子会话不允许截图校准或无边界操作。');
          }
          if (request.type === "VV_SET_INTERACTION") {
            if (interaction.configure(request.binding) && !request.binding.enabled) { adapter.release(); scopedQuiz?.adapter.release(); scopedQuiz=null; }
            sendResponse({ ok: true, result: true });
            return;
          }
          if (request.type === "VV_ARM_NATIVE_INPUT") {
            interaction.armNativeInput(request.ticket);
            sendResponse({ ok: true, result: true });
            return;
          }
          const signal = interaction.signal(request.type === "VV_EXECUTE" ? request.plan.session_id : undefined,
            request.type === "VV_EXECUTE" ? request.interaction_epoch : undefined);
          if (request.type === "VV_VISUAL_GEOMETRY") {
            const geometry = captureVisualGeometry(document, adapter.detectHardBlocker());
            if (request.binding) interaction.protectVisualScope(request.binding, geometry);
            sendResponse({ ok: true, result: geometry });
          } else if (request.type === "VV_WAIT_READY") {
            sendResponse({ ok: true, result: await adapter.waitUntilReady(signal) });
          } else if (request.type === "VV_OBSERVE") {
            sendResponse({ ok: true, result: await adapter.observeSession(request.session_id, signal, request.mode) });
          } else if (request.type === "VV_READ_STATE") {
            sendResponse({ ok: true, result: await adapter.readState(signal) });
          } else if (request.type === "VV_READ_TIMER") {
            sendResponse({ ok: true, result: await adapter.readTimer(signal) });
          } else if (request.type === "VV_EXECUTE") {
            sendResponse({
              ok: true,
              result: await interaction.runAutomation(() => adapter.execute(request.plan, request.locator_map, signal)),
            });
          } else if (request.type === "VV_CAPTURE_SEPARATION") {
            sendResponse({ ok: true, result: adapter.captureSeparation() });
          } else if (request.type === "VV_APPLY_SEPARATION") {
            sendResponse({ ok: true, result: adapter.applySeparation(request.roles) });
          } else if (request.type === "VV_REUSE_SEPARATION") {
            sendResponse({ ok: true, result: adapter.reuseSeparation(request.structure) });
          } else {
            const result = request.temporary_handles.flatMap((temporaryHandle) => {
              const source = adapter.resolveMediaSource(temporaryHandle);
              return source ? [{ temporary_handle: temporaryHandle, ...source }] : [];
            });
            sendResponse({ ok: true, result });
          }
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : "Content operation failed." });
        }
      })();
      return true;
    },
  );
}
