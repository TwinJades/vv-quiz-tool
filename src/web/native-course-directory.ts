import type {CourseSurfaceReading,CourseSurfaceSnapshot} from './course-surface';
import {isExplicitlyHidden,normalizedText} from './dom-utils';
import {readZhidaoDirectory} from './zhidao-directory';

interface DirectoryRow {
  id:string;chapter:string;title:string;root:HTMLElement;entry:HTMLElement;label:HTMLElement;
  status?:CourseSurfaceReading['lessons'][number]['status']|undefined;statusElement?:HTMLElement|undefined;
}
export interface NativeCourseDirectory {
  course:string;context:string|null;title:string;lesson:string|null;root:HTMLElement;
  rows:DirectoryRow[];nodes:HTMLElement[];scroll:HTMLElement|null;
}

export function readNativeCourseDirectory(document:Document):NativeCourseDirectory|null {
  const url=new URL(document.location.href);
  const visible=(node:HTMLElement)=>!isExplicitlyHidden(node);
  let course:string|null=null,context:string|null=null,lesson:string|null=null,rows:DirectoryRow[]=[];
  if(url.hostname==='chaoxing.com'||url.hostname.endsWith('.chaoxing.com')){
    course=url.searchParams.get('courseid')??url.searchParams.get('courseId');
    context=url.searchParams.get('clazzid')??url.searchParams.get('classId');
    lesson=url.searchParams.get('chapterId')??url.searchParams.get('knowledgeid');
    for(const root of [...document.querySelectorAll<HTMLElement>('.posCatalog_select[id^="cur"],.chapter_item[id^="cur"]')].filter(visible)){
      const id=/^cur(\d+)$/.exec(root.id)?.[1],labels=[...root.querySelectorAll<HTMLElement>(':scope > .posCatalog_name,:scope > .catalog_title > .catalog_name > a.clicktitle')].filter(visible);
      if(!id||labels.length!==1||!normalizedText(labels[0]!.innerText))return null;
      const group=root.closest<HTMLElement>('[chapterid],[data-chapter-id]');
      const completed=root.querySelector<HTMLElement>(':scope > .icon_Completed'),pending=root.querySelector<HTMLElement>(':scope > .catalog_points_yi');
      const statusElement=completed??pending??undefined;
      const status=completed&&/已完成/.test(completed.textContent??'')?'completed':pending&&/个待完成任务点/.test(pending.textContent??'')?'not_started':undefined;
      rows.push({id,chapter:group?.getAttribute('chapterid')??group?.getAttribute('data-chapter-id')??id,title:normalizedText(labels[0]!.innerText),root,entry:labels[0]!,label:labels[0]!,status,statusElement});
    }
    if(!rows.length)return null;
    if(!course||!context){
      const identities=rows.flatMap(row=>{
        const href=row.entry.getAttribute('href');if(!href||!URL.canParse(href,url.href))return [];
        const target=new URL(href,url.href),targetCourse=target.searchParams.get('courseid')??target.searchParams.get('courseId'),targetContext=target.searchParams.get('clazzid')??target.searchParams.get('classId');
        return target.origin===url.origin&&targetCourse&&targetContext?[{course:targetCourse,context:targetContext}]:[];
      });
      if(!identities.length||identities.some(value=>value.course!==identities[0]!.course||value.context!==identities[0]!.context))return null;
      course??=identities[0]!.course;context??=identities[0]!.context;
    }
  }else{
    const directory=readZhidaoDirectory(document);
    if(!directory||directory.diagnostics.length>2||!directory.points.length)return null;
    course=directory.course_id;context=directory.context_id;
    for(const point of directory.points){
      const roots=[...document.querySelectorAll<HTMLElement>('.item-content[knowledgeid]')].filter(node=>visible(node)&&node.getAttribute('knowledgeid')===point.id);
      if(roots.length!==1)return null;
      const root=roots[0]!,label=root.querySelector<HTMLElement>('.item-title');
      if(!label)return null;
      rows.push({id:point.id,chapter:point.module_id,title:point.title,root,entry:root,label});
    }
  }
  if(new Set(rows.map(row=>row.id)).size!==rows.length)throw new Error('课程目录包含重复的课时编号。');
  let root=rows[0]!.root;
  while(rows.some(row=>!root.contains(row.root))&&root.parentElement)root=root.parentElement;
  // 未支持的分页和折叠结构交给语义识别，避免将部分目录认作全部。
  if([...document.querySelectorAll<HTMLElement>('[aria-expanded=false],[aria-busy=true],.el-pagination,.pagination')].some(visible))return null;
  if([...root.querySelectorAll<HTMLElement>('.posCatalog_select[id^="cur"],.chapter_item[id^="cur"],.item-content[knowledgeid]')].some(node=>!visible(node)))return null;
  let scroll:HTMLElement|null=root;
  while(scroll&&!(scroll.scrollHeight>scroll.clientHeight+2&&/auto|scroll/.test(document.defaultView!.getComputedStyle(scroll).overflowY)))scroll=scroll.parentElement;
  scroll??=document.scrollingElement as HTMLElement|null;
  const parentTitle=document.defaultView?.frameElement?.ownerDocument.title;
  return {course:course!,context,title:normalizedText(document.title)||normalizedText(parentTitle)||`课程 ${course}`,lesson,root,rows,scroll,nodes:[root,...(scroll?[scroll]:[]),...rows.flatMap(row=>[row.root,row.entry,row.label,...(row.statusElement?[row.statusElement]:[])])]};
}

export function nativeDirectoryReading(directory:NativeCourseDirectory,snapshot:CourseSurfaceSnapshot,nodes:Map<HTMLElement,string>):CourseSurfaceReading {
  const id=(node:HTMLElement)=>{const value=nodes.get(node);if(!value)throw new Error('目录元素在读取期间发生变化。');return value;};
  return {capture_id:snapshot.capture_id,stage:directory.lesson?'lesson':'directory',course_id:directory.course,context_id:directory.context,title:directory.title,
    current_lesson_id:directory.lesson,current_resource_id:null,directory_root_id:id(directory.root),
    lessons:directory.rows.map(row=>({id:row.id,root_id:id(row.root),enter_id:id(row.entry),title:row.title,chapter_id:row.chapter,prerequisites:[],status_id:row.statusElement?id(row.statusElement):null,
      status:row.root.hasAttribute('disabled')||row.root.getAttribute('aria-disabled')==='true'?'locked':row.status??'unknown'})),
    expand_ids:[],more_id:null,previous_id:null,scroll_root_id:directory.scroll?id(directory.scroll):null,busy:false,total:null,resources_complete:false,resources_total:null,resources:[],controls:[],
    video_root_id:null,quiz_root_id:null,record_ids:[],submission_ids:[],passed:null,
    quiz_rules:{scored:null,retry_allowed:null,remaining_attempts:null,requires_pass:null,requires_rewatch:null},speed_allowed:null,visibility_required:null};
}
