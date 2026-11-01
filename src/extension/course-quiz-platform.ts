import type {CourseTabPlatform} from './course-platform';
import type {LearningTask,QuizBoundary} from '../core/course';
import type {RuntimePlatform,RuntimeMediaPayload} from '../core/orchestrator';
import type {PlatformObservation,PlatformState} from '../core/platform';
import type {ActionResult,ExecutionPlan,LocatorMap} from '../core/schema';
import type {VercelAiSolverProvider} from '../provider/solver-provider';
import type {InitialSemanticSnapshot} from '../web/initial-snapshot';
import type {ChaoxingPracticeReviewReading} from '../web/chaoxing-practice';
import {VisualWebAdapter} from '../web/visual-adapter';
import {requireCurrentWebsite} from './website-access';

export class ScopedQuizPlatform implements RuntimePlatform {
  #mapped=false;
  #visual:VisualWebAdapter|null=null;
  #media=new Map<string,RuntimeMediaPayload>();
  constructor(private parent:CourseTabPlatform,private boundary:QuizBoundary,private task:LearningTask,private solver?:VercelAiSolverProvider,private imagesAuthorized=false,private nativeChaoxing=false){}
  interactionMatches(id:string,epoch:string){const binding=this.parent.interactionBinding();return binding.session_id===id&&binding.epoch===epoch&&binding.enabled;}
  async enableInteraction(_id?:string){await this.parent.enableInteraction();}
  async disableInteraction(){await this.#visual?.close();this.#visual=null;this.#mapped=false;this.#media.clear();}
  capabilities(){return {question_types:['single_choice','multiple_choice','fill_blank'] as Array<'single_choice'|'multiple_choice'|'fill_blank'>,multi_question_page:true,text_input:true,image_input:true,semantic_targeting:true,coordinate_targeting:this.imagesAuthorized,submit:true,advance:true,grading_feedback:true,timer_observation:this.boundary.kind!=='video_popup'};}
  async waitUntilReady(signal:AbortSignal){const ready=await this.parent.quizRequest<{ready:boolean;reason?:string}>(this.boundary,this.task,{type:'VV_WAIT_READY'},signal);if(ready.reason==='semantic_structure_changed'){this.#mapped=false;return {ready:true};}return ready;}
  async observeSession(session_id:string,signal:AbortSignal){
    if(this.#visual)return this.#visual.observeSession(session_id,signal);
    let questionIds:string[]|undefined;
    if(!this.#mapped&&this.solver){
      const binding=this.parent.interactionBinding();
      const snapshot=await this.parent.quizRequest<InitialSemanticSnapshot>(this.boundary,this.task,{type:'VV_CAPTURE_INITIAL_SEMANTIC',binding},signal);
      if(this.nativeChaoxing&&snapshot.chaoxing_question_ids?.length){if(snapshot.rendered_text_required)questionIds=snapshot.chaoxing_question_ids;else this.#mapped=true;}
      else{
        const reading=snapshot.rendered_text_required?{region_ids:[],use_visual:true}:await this.solver.recognizeInitialSemantic(snapshot,signal);
        if(reading.use_visual){
          if(!this.imagesAuthorized)throw new Error('实际题干需要截图，当前Provider没有图片授权。');
          const transport=await this.parent.quizTransport(this.boundary,this.task,signal);
          this.#visual=new VisualWebAdapter(transport,(capture,s,context)=>this.solver!.recognizeVisual(capture,s,context));
          return this.#visual.observeSession(session_id,signal);
        }
        if(!await this.parent.quizRequest<boolean>(this.boundary,this.task,{type:'VV_APPLY_INITIAL_SEMANTIC',binding,reading},signal))throw new Error('弹题结构未通过实际控件验证。');
        this.#mapped=true;
      }
    }
    const observation=await this.parent.quizRequest<PlatformObservation>(this.boundary,this.task,{type:'VV_OBSERVE',session_id,mode:'structured'},signal);
    if(questionIds){
      if(!this.imagesAuthorized)throw new Error('学习通实际题目截图需要Provider图片授权。');
      if(questionIds.length!==observation.questions.length)throw new Error('学习通题目清单与实际作答结构不一致。');
      this.#media.clear();
      for(const [index,parsed] of observation.questions.entries()){
        const question=parsed.question,transport=await this.parent.quizTransport(this.boundary,this.task,signal,questionIds[index]);
        try{
          const capture=await transport.capture(session_id,observation.observation_id,signal),handle=capture.frame.temporary_handle;
          this.#media.set(handle,{temporary_handle:handle,mime_type:'image/png',data:capture.data});
          question.stem={text:`第${index+1}题，题干和选项以实际题目截图为准。`,format:'plain_text',media:[{id:handle,kind:'image',purpose:'实际题干与全部选项',temporary_handle:handle,mime_type:'image/png',source:'region_capture',width:capture.frame.width,height:capture.frame.height}]};
          question.options=question.options.map((option,position)=>({...option,text:`${String.fromCharCode(65+position)} 选项，内容见实际截图。`,media:[]}));
          question.provenance.text_source='visual';
        }finally{await transport.close();}
      }
    }
    return observation;
  }
  async readState(signal:AbortSignal){const state=await this.parent.quizRequest<PlatformState>(this.boundary,this.task,{type:'VV_READ_STATE'},signal);if(state.completed||!this.#visual)return state;return {...await this.#visual.readState(signal),completed:false};}
  readTimer(signal:AbortSignal){return this.parent.quizRequest<number|null>(this.boundary,this.task,{type:'VV_READ_TIMER'},signal);}
  async execute(plan:ExecutionPlan,locator_map:LocatorMap,signal:AbortSignal){
    const submitting=plan.actions.some(action=>action.kind==='submit_session'||action.kind==='submit_question'||this.boundary.kind==='video_popup'&&action.kind==='set_selected'&&action.value);
    if(submitting)await this.parent.quizRequest(this.boundary,this.task,{type:'VV_COURSE_SUBMISSION',phase:'arm'},signal);
    const result=this.#visual?await this.#visual.execute(plan,locator_map,signal):await this.parent.quizRequest<ActionResult[]>(this.boundary,this.task,{type:'VV_EXECUTE',plan,locator_map},signal);
    if(submitting)await this.parent.quizRequest(this.boundary,this.task,{type:'VV_COURSE_SUBMISSION',phase:result.every(action=>action.status==='succeeded')?'confirm':'cancel'},signal);
    return result;
  }
  async resolveMedia(handles:string[],signal:AbortSignal):Promise<RuntimeMediaPayload[]>{
    if(!handles.length)return [];
    if(this.#visual)return this.#visual.resolveMedia(handles,signal);
    const captures=handles.flatMap(handle=>this.#media.has(handle)?[this.#media.get(handle)!]:[]);
    handles=handles.filter(handle=>!this.#media.has(handle));if(!handles.length)return captures;
    const sources=await this.parent.quizRequest<Array<{temporary_handle:string;source_url:string;mime_type:string}>>(this.boundary,this.task,{type:'VV_RESOLVE_MEDIA',temporary_handles:handles},signal),media:RuntimeMediaPayload[]=[];
    for(const source of sources){signal.throwIfAborted();const response=await fetch(source.source_url,{signal});if(!response.ok)throw new Error('题目图片读取失败。');
      const mime=response.headers.get('content-type')?.split(';')[0]??source.mime_type;if(!mime.startsWith('image/'))throw new Error('媒体内容类型无效。');
      media.push({temporary_handle:source.temporary_handle,mime_type:mime,data:new Uint8Array(await response.arrayBuffer())});}
    signal.throwIfAborted();return [...captures,...media];
  }
}

export class ChaoxingQuizPlatform implements RuntimePlatform {
  #receipt:ChaoxingPracticeReviewReading|null=null;
  #initialized=false;
  constructor(private parent:CourseTabPlatform,private task:LearningTask,private proxy:ScopedQuizPlatform){}
  private async authorize(signal:AbortSignal):Promise<void>{
    signal.throwIfAborted();await requireCurrentWebsite(this.parent.tabId);
    const frame=await chrome.webNavigation.getFrame({tabId:this.parent.tabId,frameId:0}),url=frame&&new URL(frame.url);
    if(url?.hostname!=='mooc1.chaoxing.com'||url.searchParams.get('courseId')!==this.parent.courseId||url.searchParams.get('chapterId')!==this.task.lesson_id)throw new Error('学习通测验所属课时改变。');signal.throwIfAborted();
  }
  capabilities(){return this.proxy.capabilities();}
  async waitUntilReady(signal:AbortSignal){await this.authorize(signal);return this.proxy.waitUntilReady(signal);}
  async observeSession(id:string,signal:AbortSignal){await this.authorize(signal);await this.proxy.enableInteraction(id);return this.proxy.observeSession(id,signal);}
  async readState(signal:AbortSignal):Promise<PlatformState>{
    await this.authorize(signal);
    if(!this.#initialized){
      const result=await this.parent.verify(this.task,signal);
      if(result.submission_confirmed)return {observation_id:'cx-review',fingerprint:'cx-review',selected_target_ids:[],field_values:{},feedback:null,can_retry:false,has_next:false,has_session_submit:false,completed:true,session_passed:result.passed,...(result.visible_score?{visible_score:result.visible_score}:{})};
      await this.proxy.enableInteraction(crypto.randomUUID());await this.proxy.waitUntilReady(signal);this.#initialized=true;
    }
    if(this.#receipt)return {observation_id:'cx-review',fingerprint:'cx-review',selected_target_ids:[],field_values:{},feedback:null,can_retry:false,has_next:false,has_session_submit:false,completed:true,session_passed:(await this.parent.verify(this.task,signal)).passed,visible_score:`${this.#receipt.score}/${this.#receipt.maximum}`};
    return this.proxy.readState(signal);
  }
  readTimer(signal:AbortSignal){return this.proxy.readTimer(signal);}
  resolveMedia(handles:string[],signal:AbortSignal){return this.proxy.resolveMedia(handles,signal);}
  async execute(plan:ExecutionPlan,map:LocatorMap,signal:AbortSignal):Promise<ActionResult[]>{
    await this.authorize(signal);if(this.#receipt)throw new Error('学习通测验已经提交。');
    if(plan.actions.length===1&&['submit_session','submit_question'].includes(plan.actions[0]!.kind)){
      await this.proxy.disableInteraction();this.#receipt=await this.parent.submitChaoxing(this.task,signal);return [{action_id:plan.actions[0]!.action_id,status:'succeeded'}];
    }
    return this.proxy.execute(plan,map,signal);
  }
}
