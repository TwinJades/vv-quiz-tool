import {afterEach,describe,expect,it,vi} from 'vitest';
import {Window} from 'happy-dom';
import {detectSharedCatalog,sharedLessonActive,sharedLessonProgress,waitForSharedLessonActive} from '../../src/web/zhidao-shared-course';
import {SemanticCoursePage} from '../../src/web/semantic-course-page';
import type {CourseSurfaceReading} from '../../src/web/course-surface';

function page(url:string,html:string):Document {
  const window=new Window({url});
  window.document.body.innerHTML=html;
  return window.document as unknown as Document;
}

afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});

describe('共享课目录适配',()=>{
  it.each([
    ['https://study.zhihuishu.com/', '<div class="child-info hasvideo current"><i class="child-check"></i></div>', 'wisdom'],
    ['https://fusioncourseh5.zhihuishu.com/', '<div class="chapter-item"><i class="chapter-content-second current"></i><i class="finish-icon"></i></div>', 'fusion'],
    ['https://hike.zhihuishu.com/', '<div class="file-item active"><i class="icon-finish"></i></div>', 'hike'],
    ['https://study.zhihuishu.com/', '<div class="clearfix video current_play"><i class="time_icofinish"></i></div>', 'legacy']
  ])('识别 %s 对应的 %s', (url,html,name)=>{
    const document=page(url,html),catalog=detectSharedCatalog(document)!;
    expect(catalog.name).toBe(name);
    const row=document.querySelector<HTMLElement>(catalog.item)!;
    expect(sharedLessonActive(row,catalog)).toBe(true);
    expect(sharedLessonProgress(row,catalog)).toBe(100);
  });

  it('按站点候选顺序选择，不在AI域或hike上误认其他目录',()=>{
    const html='<div class="child-info hasvideo"></div><div class="chapter-item"></div><div class="clearfix video"></div>';
    expect(detectSharedCatalog(page('https://study.zhihuishu.com/',html))?.name).toBe('wisdom');
    expect(detectSharedCatalog(page('https://study.zhihuishu.com/fusioncourseh5/',html))?.name).toBe('fusion');
    expect(detectSharedCatalog(page('https://hike.zhihuishu.com/',html))).toBeNull();
    expect(detectSharedCatalog(page('https://ai-smart-course-student-pro.zhihuishu.com/',html))).toBeNull();
    expect(detectSharedCatalog(page('https://study.zhihuishu.com/',''))).toBeNull();
  });

  it('只读取所属行的有效进度，隐藏完成标记不代表完成',()=>{
    const document=page('https://study.zhihuishu.com/','<div class="child-info hasvideo"><i class="child-check" hidden></i><span role="progressbar" aria-valuenow=""></span></div><div class="child-info hasvideo"><i class="child-check"></i></div>');
    const catalog=detectSharedCatalog(document)!,row=document.querySelector<HTMLElement>(catalog.item)!,progress=row.querySelector('[role=progressbar]')!;
    expect(sharedLessonProgress(row,catalog)).toBeNull();
    for(const [value,expected] of [['NaN',null],['Infinity',null],['-10',0],['32.9',32],['120',100],['0',0]] as const){
      progress.setAttribute('aria-valuenow',value);
      expect(sharedLessonProgress(row,catalog)).toBe(expected);
    }
    progress.remove();
    expect(sharedLessonProgress(row,catalog)).toBeNull();
    row.querySelector('.child-check')!.removeAttribute('hidden');
    expect(sharedLessonProgress(row,catalog)).toBe(100);
  });

  it('读取文本进度与未知值，行内激活不依赖其他行',()=>{
    const document=page('https://hike.zhihuishu.com/','<div class="file-item"><span class="rate"> 45.8% </span></div><div class="file-item active"></div>');
    const catalog=detectSharedCatalog(document)!,row=document.querySelector<HTMLElement>(catalog.item)!;
    expect(sharedLessonProgress(row,catalog)).toBe(45);
    expect(sharedLessonActive(row,catalog)).toBe(false);
    row.querySelector('.rate')!.textContent='--';
    expect(sharedLessonProgress(row,catalog)).toBeNull();
  });

  it('等待期间每次重定位重渲染的行',async()=>{
    vi.useFakeTimers();
    const document=page('https://fusioncourseh5.zhihuishu.com/','<div class="chapter-item"></div>');
    const catalog=detectSharedCatalog(document)!,resolve=vi.fn(()=>document.querySelector<HTMLElement>(catalog.item));
    const result=waitForSharedLessonActive(resolve,catalog,new AbortController().signal);
    document.body.innerHTML='<div class="chapter-item"><span class="chapter-content-second current"></span></div>';
    await vi.advanceTimersByTimeAsync(200);
    await expect(result).resolves.toBe(true);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('八秒到期返回未激活，不隐式点击',async()=>{
    vi.useFakeTimers();
    const document=page('https://study.zhihuishu.com/','<button class="child-info hasvideo"></button>');
    const catalog=detectSharedCatalog(document)!,row=document.querySelector<HTMLElement>(catalog.item)!,click=vi.spyOn(row,'click');
    const result=waitForSharedLessonActive(()=>row,catalog,new AbortController().signal);
    await vi.advanceTimersByTimeAsync(8000);
    await expect(result).resolves.toBe(false);
    expect(click).not.toHaveBeenCalled();
  });

  it('取消立即停止等待且不继续定位',async()=>{
    vi.useFakeTimers();
    const document=page('https://study.zhihuishu.com/','<div class="child-info hasvideo"></div>');
    const catalog=detectSharedCatalog(document)!,controller=new AbortController(),resolve=vi.fn(()=>document.querySelector<HTMLElement>(catalog.item));
    const result=waitForSharedLessonActive(resolve,catalog,controller.signal);
    const reason=new Error('已取消');
    const rejected=expect(result).rejects.toBe(reason);
    controller.abort(reason);
    await rejected;
    await vi.advanceTimersByTimeAsync(8000);
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});

describe('共享课语义页面集成',()=>{
  function fixture(active=false){
    const window=new Window({url:'https://study.zhihuishu.com/course?courseId=77&classId=88'});
    const document=window.document as unknown as Document;
    document.body.innerHTML=`<div id="summary">全课进度 100%</div><button class="child-info hasvideo${active?' current':''}" data-lesson-id="lesson-1">第一课<span role="progressbar" aria-valuenow="20"></span></button><div data-id="video-1">视频<button data-id="video-entry">播放</button><video></video></div>`;
    let hit:Element|null=null;
    vi.spyOn(window.HTMLElement.prototype,'scrollIntoView').mockImplementation(()=>{});
    vi.spyOn(window.HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){hit=this;return new window.DOMRect(0,0,100,30);});
    vi.spyOn(document,'elementFromPoint').mockImplementation(()=>hit);
    const semantic=new SemanticCoursePage(document,'zhidao'),snapshot=semantic.capture();
    const id=(attribute:string,value:string)=>{
      const element=snapshot.elements.find(item=>item.attributes[attribute]===value);
      if(!element)throw new Error(`缺少公开元素 ${attribute}=${value}`);
      return element.element_id;
    };
    const lessonId=id('data-lesson-id','lesson-1'),resourceId=id('data-id','video-1'),entryId=id('data-id','video-entry');
    const videoId=snapshot.elements.find(item=>item.tag==='video')!.element_id;
    const reading:CourseSurfaceReading={capture_id:snapshot.capture_id,stage:'lesson',course_id:'77',context_id:'88',title:'课程',current_lesson_id:'lesson-1',current_resource_id:'video-1',directory_root_id:null,
      lessons:[{id:'lesson-1',root_id:lessonId,enter_id:lessonId,title:'第一课',chapter_id:'chapter-1',prerequisites:[],status_id:null,status:'in_progress'}],
      expand_ids:[],more_id:null,previous_id:null,scroll_root_id:null,busy:false,total:1,resources_complete:true,resources_total:1,
      resources:[{id:'video-1',root_id:resourceId,enter_id:entryId,title:'视频',chapter_id:'chapter-1',prerequisites:[],status_id:null,status:'in_progress',kind:'video'}],
      controls:[],video_root_id:videoId,quiz_root_id:null,record_ids:[id('id','summary')],submission_ids:[],passed:null,
      quiz_rules:{scored:null,retry_allowed:null,remaining_attempts:null,requires_pass:null,requires_rewatch:null},speed_allowed:null,visibility_required:null};
    semantic.apply(reading);
    const catalog=semantic.catalog();semantic.bind(catalog);
    const task=catalog.tasks[0]!,signal=new AbortController().signal;
    return {document,semantic,task,signal};
  }

  it('已激活的课时无需点击',async()=>{
    const {document,semantic,task,signal}=fixture(true),row=document.querySelector<HTMLElement>('[data-lesson-id]')!,click=vi.spyOn(row,'click');
    await expect(semantic.execute({operation:'enter',course_id:'77',task},signal)).resolves.toBe(true);
    expect(click).not.toHaveBeenCalled();
  });

  it('首次点击后重建行，按公开编号定位新入口再点击',async()=>{
    vi.useFakeTimers();
    const {document,semantic,task,signal}=fixture(),first=document.querySelector<HTMLElement>('[data-lesson-id]')!;
    const clicks:string[]=[];
    first.addEventListener('click',()=>{
      clicks.push('old');
      const replacement=first.cloneNode(true) as HTMLElement;
      replacement.addEventListener('click',()=>{clicks.push('new');replacement.classList.add('current');});
      first.replaceWith(replacement);
    });
    const result=semantic.execute({operation:'enter',course_id:'77',task},signal);
    await vi.advanceTimersByTimeAsync(8000);
    await expect(result).resolves.toBe(true);
    expect(clicks).toEqual(['old','new']);
  });

  it('两次点击仍未激活时停止，不再尝试',async()=>{
    vi.useFakeTimers();
    const {document,semantic,task,signal}=fixture(),row=document.querySelector<HTMLElement>('[data-lesson-id]')!,click=vi.spyOn(row,'click');
    const result=semantic.execute({operation:'enter',course_id:'77',task},signal);
    const rejected=expect(result).rejects.toThrow('COURSE_OBSERVATION_STALE: 共享课时未激活');
    await vi.advanceTimersByTimeAsync(16000);
    await rejected;
    expect(click).toHaveBeenCalledTimes(2);
  });

  it('公开课时编号冲突时不操作任一入口',async()=>{
    const {document,semantic,task,signal}=fixture(),row=document.querySelector<HTMLElement>('[data-lesson-id]')!,duplicate=row.cloneNode(true) as HTMLElement;
    row.after(duplicate);
    const first=vi.spyOn(row,'click'),second=vi.spyOn(duplicate,'click');
    await expect(semantic.execute({operation:'enter',course_id:'77',task},signal)).rejects.toThrow('COURSE_IDENTITY_MISMATCH');
    expect(first).not.toHaveBeenCalled();expect(second).not.toHaveBeenCalled();
  });

  it('视频完成核验只使用所属课时行进度，不采用全课汇总',async()=>{
    const {document,semantic,task,signal}=fixture();
    const videoTask={...task,id:task.id+':video:video-1',resource_id:'video-1',kind:'video' as const,title:'视频'};
    await semantic.execute({operation:'enter',course_id:'77',task:videoTask},signal);
    const verify=()=>semantic.execute({operation:'verify',course_id:'77',task:videoTask},signal);
    expect(await verify()).toMatchObject({progress_recorded:false,completed:false});
    document.querySelector('[role=progressbar]')!.setAttribute('aria-valuenow','100');
    expect(await verify()).toMatchObject({progress_recorded:true,completed:true});
  });
});
