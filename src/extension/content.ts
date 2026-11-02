import { DomWebAdapter } from "../web/dom-adapter";
import type { ContentRequest, ContentResponse } from "./messages";
import { InteractionGuard } from "./interaction-guard";
import { captureVisualGeometry } from "../web/visual-geometry";
import { CoursePageAdapter, CoursePageLease, coursePlatform } from '../web/course-adapter';
import type { PlatformState } from '../core';
import type {VideoSnapshot} from '../core/course';
import { inspectCoursePage } from '../web/course-inspection';
import { isExplicitlyHidden, normalizedText } from '../web/dom-utils';
import { isObservedCourseInteraction } from '../web/course-interaction';
import {chaoxingVideoQuizReady} from '../web/chaoxing-video-quiz';
import { readZhidaoResult } from '../web/zhidao-result';
import {KnowledgePracticePage} from '../web/knowledge-practice-page';
import {readChaoxingPractice,applyChaoxingPracticeAnswers,submitChaoxingPractice} from '../web/chaoxing-practice';
import {readChaoxingLearningPage} from '../web/chaoxing-learning-page';
import {courseQuizGeometry,scrollCourseQuizIntoView} from '../web/course-quiz-geometry';
import {resolveChaoxingResourceFrame} from '../web/course-resource-identity';
declare const __VV_BUILD_ID__:string;

declare global {
  interface Window {
    __vvContentInstalled?: boolean;
    __vvContentInstallation?:{build_id:string;dispose():void};
  }
}

if (window.__vvContentInstallation?.build_id!==__VV_BUILD_ID__) {
  window.__vvContentInstallation?.dispose();
  window.__vvContentInstalled = true;
  const adapter = new DomWebAdapter(document);
  const knowledgePage=new KnowledgePracticePage(document);
  let coursePage: CoursePageAdapter | null = null;
  const courseLease=new CoursePageLease(document);
  let scopedQuiz: { root: HTMLElement; adapter: DomWebAdapter } | null = null;
  let courseSubmit: {parentId:string;boundaryId:string;taskId:string;state:PlatformState;videoId:string|null;confirmed:boolean}|null=null;
  const interaction = new InteractionGuard(document, target => adapter.isQuizInteractionTarget(target) ||
    Boolean(coursePage?.semanticInteractionTarget(target)) ||
      isObservedCourseInteraction(document,target), binding => {
    void chrome.runtime.sendMessage({ type: "VV_USER_INTERACTION", session_id: binding.session_id, epoch: binding.epoch }).catch(() => {
      // Execution stays blocked locally even if the worker is unavailable.
    });
  });

  const messageListener=(request: ContentRequest, _sender:chrome.runtime.MessageSender, sendResponse: (response: ContentResponse) => void) => {
      void (async () => {
        try {
          if(request.type==='VV_COURSE_FRAME_RECT'){
            const frames=Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe')).filter(frame=>!isExplicitlyHidden(frame)&&new URL(frame.src,location.href).href===request.child_url);
            if(frames.length!==1)throw new Error('课程框架所属元素无法唯一确认。');
            const frame=frames[0]!;frame.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});const rect=frame.getBoundingClientRect();
            sendResponse({ok:true,result:{rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},width:frame.offsetWidth,height:frame.offsetHeight,left:frame.clientLeft,top:frame.clientTop}});return;
          }
          if(request.type==='VV_PAUSE_COURSE_MEDIA'){
            if(!interaction.matches(request.session_id,request.interaction_epoch))throw new Error('课程暂停请求的会话身份已改变。');
            const platform=coursePlatform(location.href);if(!platform)throw new Error('课程暂停页面身份未确认。');
            coursePage=courseLease.forSession(platform,request.session_id);
            sendResponse({ok:true,result:coursePage.pauseCurrent(request.course_id,request.context_id,request.context)});return;
          }
          if(request.type==='VV_CAPTURE_COURSE_SURFACE'||request.type==='VV_APPLY_COURSE_SURFACE'||request.type==='VV_EXPAND_COURSE_SURFACE'||request.type==='VV_COURSE_EMBEDDED_FRAMES'){
            const platform=coursePlatform(location.href);if(!platform)throw new Error('当前页面没有课程平台身份。');
            const blocker=adapter.detectHardBlocker();if(blocker)throw new Error(blocker);
            coursePage=courseLease.forSession(platform,request.session_id);
            if(request.type==='VV_CAPTURE_COURSE_SURFACE'){sendResponse({ok:true,result:coursePage.captureSemantic(request.context,request.intent)});return;}
            if(request.type==='VV_COURSE_EMBEDDED_FRAMES'){sendResponse({ok:true,result:coursePage.embeddedFrames()});return;}
            if(request.type==='VV_APPLY_COURSE_SURFACE'){coursePage.applySemantic(request.reading);sendResponse({ok:true,result:true});return;}
            const signal=interaction.signal(request.session_id,request.interaction_epoch);
            sendResponse({ok:true,result:await interaction.runAutomation(()=>coursePage!.expandSemantic(signal,request.direction))});return;
          }
          if(request.type==='VV_SUBMIT_CHAOXING'){
            const signal=interaction.signal(request.session_id,request.interaction_epoch),learning=readChaoxingLearningPage(document);
            if(!learning||learning.course_id!==request.course_id||learning.lesson_id!==request.lesson_id)throw new Error('学习通提交课程或课时身份改变。');
            const work=resolveChaoxingResourceFrame(document,'quiz',request.resource_id).contentDocument?.querySelector<HTMLIFrameElement>('iframe#frame_content')?.contentDocument;
            const reading=work&&readChaoxingPractice(work);
            if(!reading||!work||reading.course_id!==request.course_id||reading.lesson_id!==request.lesson_id)throw new Error('学习通提交页面尚未确认。');
            const result=await interaction.runAutomation(async()=>{
              const applied=applyChaoxingPracticeAnswers(work,reading,reading.questions.map(question=>({id:question.id,letters:question.options.filter(option=>option.selected===true).map(option=>option.letter)})),signal);
              return submitChaoxingPractice(document,work,applied,signal);
            });
            sendResponse({ok:true,result});return;
          }
          if(request.type==='VV_INSPECT_COURSE_PAGE'){sendResponse({ok:true,result:inspectCoursePage(document)});return;}
          if(request.type==='VV_KNOWLEDGE_PAGE'){
            const blocker=adapter.detectHardBlocker();if(blocker)throw new Error(blocker);
            const preview=request.request.operation==='catalog'&&!request.session_id;
            const pause=request.request.operation==='pause'&&request.session_id&&request.interaction_epoch&&interaction.matches(request.session_id,request.interaction_epoch);
            const signal=preview||pause?new AbortController().signal:interaction.signal(request.session_id,request.interaction_epoch);
            signal.throwIfAborted();const result=await interaction.runAutomation(()=>knowledgePage.execute(request.request,signal));
            signal.throwIfAborted();sendResponse({ok:true,result});return;
          }
          if (request.type === 'VV_COURSE' || request.type === 'VV_COURSE_QUIZ') {
            const platform = coursePlatform(location.href);
            if (!platform) throw new Error('当前网站不是知到或学习通课程页面。');
            const blocker = adapter.detectHardBlocker(); if (blocker) throw new Error(blocker);
            if (request.type === 'VV_COURSE') {
              const operation = request.request.operation;
              const pause = operation === 'pause';
              const signal = pause && interaction.matches(request.session_id,request.interaction_epoch)
                ? new AbortController().signal : interaction.signal(request.session_id,request.interaction_epoch);
              signal.throwIfAborted();
              const page=coursePage=courseLease.forSession(platform,request.session_id);
              const result = await interaction.runAutomation(() => page.execute(request.request,signal));
              signal.throwIfAborted();sendResponse({ok:true,result});return;
            }
            const signal = interaction.signal(request.parent_session_id,request.interaction_epoch);
            signal.throwIfAborted();coursePage=courseLease.forSession(platform,request.parent_session_id);
            if(request.request.type==='VV_COURSE_SUBMISSION'&&request.request.phase!=='arm'){
              if(courseSubmit?.parentId!==request.parent_session_id||courseSubmit.boundaryId!==request.boundary.id||courseSubmit.taskId!==request.task.id)throw new Error('弹题提交确认缺少本次操作记录。');
              courseSubmit.confirmed=request.request.phase==='confirm';sendResponse({ok:true,result:true});return;
            }
            let root:HTMLElement;
            try { root=coursePage.assertBoundary(request.course_id,request.task,request.boundary); }
            catch(error){
              if(request.request.type==='VV_READ_STATE'&&request.boundary.kind==='video_popup'&&courseSubmit?.confirmed&&courseSubmit.parentId===request.parent_session_id&&courseSubmit.boundaryId===request.boundary.id&&courseSubmit.taskId===request.task.id){
                const video=await coursePage.execute({operation:'video',course_id:request.course_id,task:request.task},signal) as VideoSnapshot;
                if(video.video_id!==courseSubmit.videoId||video.popup)throw error;
                sendResponse({ok:true,result:{...courseSubmit.state,completed:true,session_passed:null,feedback:null,can_retry:false,has_next:false,has_session_submit:false}});return;
              }
              throw error;
            }
            if(request.boundary.task_id!==request.task.id)throw new Error('测验资源身份改变。');
            if(!scopedQuiz || scopedQuiz.root !== root){scopedQuiz?.adapter.release();scopedQuiz={root,adapter:new DomWebAdapter(root.ownerDocument,undefined,root)};}
            const quiz=scopedQuiz.adapter;const inner=request.request;
            if(inner.type==='VV_VISUAL_GEOMETRY'){
              const geometry=courseQuizGeometry(document,root,quiz.detectHardBlocker());
              interaction.protectVisualScope({session_id:request.parent_session_id,epoch:request.interaction_epoch,enabled:true},geometry);
              sendResponse({ok:true,result:geometry});return;
            }
            if(inner.type==='VV_COURSE_SUBMISSION'){
              const state=await quiz.readState(signal);
              const videoId=request.boundary.kind==='video_popup'?(await coursePage.execute({operation:'video',course_id:request.course_id,task:request.task},signal) as VideoSnapshot).video_id:null;
              courseSubmit={parentId:request.parent_session_id,boundaryId:request.boundary.id,taskId:request.task.id,state,videoId,confirmed:false};sendResponse({ok:true,result:true});return;
            }
            if(inner.type==='VV_CAPTURE_INITIAL_SEMANTIC'){
              const snapshot=quiz.captureInitialSemantic(),native=readChaoxingPractice(root.ownerDocument);
              if(native)snapshot.chaoxing_question_ids=native.questions.map(question=>question.id);
              sendResponse({ok:true,result:snapshot});return;
            }
            if(inner.type==='VV_CHAOXING_QUESTION_GEOMETRY'){
              const reading=readChaoxingPractice(root.ownerDocument);
              if(!reading?.questions.some(question=>question.id===inner.question_id))throw new Error('学习通题目截图身份已改变。');
              const roots=Array.from(root.querySelectorAll<HTMLElement>('.TiMu.newTiMu')).filter(question=>question.querySelector('li[qid]')?.getAttribute('qid')===inner.question_id);
              if(roots.length!==1)throw new Error('学习通题目截图范围不唯一。');
              scrollCourseQuizIntoView(document,roots[0]!);
              const geometry=courseQuizGeometry(document,roots[0]!,quiz.detectHardBlocker());sendResponse({ok:true,result:geometry});return;
            }
            if(inner.type==='VV_APPLY_INITIAL_SEMANTIC'){sendResponse({ok:true,result:quiz.applyInitialSemantic(inner.reading)});return;}
            if(inner.type==='VV_WAIT_READY'){
              if(request.boundary.kind==='video_popup'){
                const ready=chaoxingVideoQuizReady(root)||root.isConnected&&!isExplicitlyHidden(root)&&Array.from(root.querySelectorAll('[role=radio],[role=checkbox],.radio-view >li')).some(element=>!isExplicitlyHidden(element));
                sendResponse({ok:true,result:{ready,...(ready?{}:{reason:'实际弹题控件尚未加载。'})}});return;
              }
              sendResponse({ok:true,result:await quiz.waitUntilReady(signal)});return;
            }
            if(inner.type==='VV_OBSERVE'){
              if(request.boundary.rules.remaining_attempts===0)throw new Error('平台剩余作答次数已耗尽，停止新的模型请求。');
              sendResponse({ok:true,result:await quiz.observeSession(inner.session_id,signal,'structured')});return;
            }
            if(inner.type==='VV_EXECUTE'){
              if(request.boundary.rules.remaining_attempts===0)throw new Error('测验次数耗尽，禁止重复作答。');
              if(inner.plan.actions.some(a=>a.kind==='retry_question')&&request.boundary.rules.retry_allowed!==true)throw new Error('网站当前不允许重答。');
              const before=await quiz.readState(signal);
              const videoId=request.boundary.kind==='video_popup'?(await coursePage.execute({operation:'video',course_id:request.course_id,task:request.task},signal) as VideoSnapshot).video_id:null;
              const results=await interaction.runAutomation(()=>quiz.execute(inner.plan,inner.locator_map,signal));
              if(inner.plan.actions.some(a=>a.kind==='submit_question'||a.kind==='submit_session')&&results.every(r=>r.status==='succeeded'))courseSubmit={parentId:request.parent_session_id,boundaryId:request.boundary.id,taskId:request.task.id,state:before,videoId,confirmed:true};
              sendResponse({ok:true,result:results});return;
            }
            if(inner.type==='VV_READ_STATE'){
              const result:PlatformState=await quiz.readState(signal);
              if(request.boundary.kind==='video_popup'&&courseSubmit?.parentId===request.parent_session_id&&courseSubmit.boundaryId===request.boundary.id&&courseSubmit.taskId===request.task.id&&result.feedback===courseSubmit.state.feedback){result.feedback=null;result.question_graded=false;}
              if(request.boundary.kind==='video_popup')result.completed=false;
              else{
                const record=await coursePage.execute({operation:'verify',course_id:request.course_id,task:request.task},signal) as import('../core/course').CourseVerification;
                result.completed=record.submission_confirmed;result.session_passed=record.passed;
                if(record.visible_score)result.visible_score=record.visible_score;
              }
              result.can_retry=result.can_retry&&request.boundary.rules.remaining_attempts!==0&&request.boundary.rules.retry_allowed===true&&request.boundary.rules.requires_rewatch===false;
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
          if (request.type === "VV_CAPTURE_INITIAL_SEMANTIC" || request.type === "VV_APPLY_INITIAL_SEMANTIC") {
            interaction.signal(request.binding.session_id, request.binding.epoch).throwIfAborted();
            sendResponse({ ok: true, result: request.type === "VV_CAPTURE_INITIAL_SEMANTIC"
              ? adapter.captureInitialSemantic() : adapter.applyInitialSemantic(request.reading) });
          } else if (request.type === "VV_VISUAL_GEOMETRY") {
            const geometry = captureVisualGeometry(document, adapter.detectHardBlocker());
            if (request.full_viewport) geometry.region = { x: 0, y: 0, width: geometry.viewport.width, height: geometry.viewport.height };
            if (request.binding) interaction.protectVisualScope(request.binding, geometry);
            sendResponse({ ok: true, result: geometry });
          } else if (request.type === "VV_WAIT_READY") {
            sendResponse({ ok: true, result: await adapter.waitUntilReady(signal) });
          } else if (request.type === "VV_OBSERVE") {
            sendResponse({ ok: true, result: await adapter.observeSession(request.session_id, signal, request.mode) });
          } else if (request.type === "VV_READ_STATE") {
            sendResponse({ ok: true, result: await adapter.readState(signal) });
          } else if (request.type === 'VV_READ_ZHIDAO_RESULT') {
            signal.throwIfAborted();
            sendResponse({ok:true,result:readZhidaoResult(document)});
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
          } else if(request.type==='VV_RESOLVE_MEDIA') {
            const result = request.temporary_handles.flatMap((temporaryHandle) => {
              const source = adapter.resolveMediaSource(temporaryHandle);
              return source ? [{ temporary_handle: temporaryHandle, ...source }] : [];
            });
            sendResponse({ ok: true, result });
          } else {throw new Error('当前页面操作缺少课程边界。');
          }
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : "Content operation failed." });
        }
      })();
      return true;
    };
  chrome.runtime.onMessage.addListener(messageListener);
  window.__vvContentInstallation={build_id:__VV_BUILD_ID__,dispose:()=>{
    chrome.runtime.onMessage.removeListener(messageListener);interaction.dispose();adapter.release();scopedQuiz?.adapter.release();courseLease.close();
  }};
}
