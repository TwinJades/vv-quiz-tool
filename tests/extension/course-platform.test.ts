import {describe,expect,it} from 'vitest';
import {courseFailureIsLocal} from '../../src/core/course';
import {courseResumeUrl,courseCatalogMatchesUrl} from '../../src/extension/course-record';
import {courseSnapshotHasIdentity,courseSurfaceFingerprint} from '../../src/web/course-surface';
import type {CourseSurfaceSnapshot} from '../../src/web/course-surface';
import type {CourseCatalog} from '../../src/core/course';
import {publicMediaIdentity} from '../../src/web/public-course-url';

describe('course failure and persisted navigation policies',()=>{
  it.each(['课程视频播放器尚未加载。','视频连续两分钟没有有效播放进展。','平台任务完成记录仍未确认。'])('keeps a local task issue for %s',message=>{
    expect(courseFailureIsLocal(message)).toBe(true);
  });
  it.each(['登录失效。','当前网页未授权。','Provider rejected the local configuration.','Model call limit of 300 has been reached.','当前视频身份已改变。','会话保存失败。'])('pauses for %s',message=>{
    expect(courseFailureIsLocal(message)).toBe(false);
  });
  it('retains public navigation identities and removes credential parameters',()=>{
    expect(courseResumeUrl('https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=265936720&clazzid=153460518&chapterId=1214865778&token=discarded'))
      .toBe('https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=265936720&clazzid=153460518&chapterId=1214865778');
  });
  it('保留正常导航所需参数，拒绝范围外网站地址',()=>{
    expect(courseResumeUrl('https://study.zhihuishu.com/course?recruitAndCourseId=public&unitId=lesson&mode=video&access_token=removed')).toBe('https://study.zhihuishu.com/course?recruitAndCourseId=public&unitId=lesson&mode=video');
    expect(()=>courseResumeUrl('https://example.com/course')).toThrow();
  });
  it('公开课程和班级身份要求完整匹配，重复矛盾参数不能授权',()=>{
    const snapshot:CourseSurfaceSnapshot={capture_id:'capture',url:'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=265936720&clazzid=153460518',title:'',visible_text:'',native:false,elements:[]};
    expect(courseSnapshotHasIdentity(snapshot,'265936720','153460518')).toBe(true);
    expect(courseSnapshotHasIdentity(snapshot,'2659367','153460518')).toBe(false);
    expect(courseSnapshotHasIdentity(snapshot,'265936720','1534605')).toBe(false);
    expect(courseSnapshotHasIdentity({...snapshot,url:snapshot.url+'&courseId=another'},'265936720','153460518')).toBe(false);
    const catalog:CourseCatalog={course_id:'265936720',context_id:'153460518',platform:'chaoxing',title:'',revision:'',complete:true,tasks:[],rules:{visibility_required:null,speed_allowed:null},diagnostics:[]};
    expect(courseCatalogMatchesUrl(snapshot.url,catalog)).toBe(true);
    expect(courseCatalogMatchesUrl(snapshot.url.replace('153460518','153460519'),catalog)).toBe(false);
  });
  it('媒体身份保留公开资源编号，播放签名变化不改变资源身份',()=>{
    const a=publicMediaIdentity('https://video.chaoxing.com/video.mp4?objectId=77&sign=secret&expires=123');
    expect(a).toBe('https://video.chaoxing.com/video.mp4?objectId=77');
    expect(publicMediaIdentity('https://video.chaoxing.com/video.mp4?objectId=77&sign=renewed&expires=456')).toBe(a);
    expect(publicMediaIdentity('https://video.chaoxing.com/video.mp4?objectId=78')).not.toBe(a);
    expect(publicMediaIdentity('blob:https://video.chaoxing.com/temporary')).toBeNull();
  });
  it('字幕和播放计时变化保留观察缓存，弹题与平台记录变化重新识别',()=>{
    const element={element_id:'player',parent_id:null,tag:'video',text:'',classes:[],role:null,input_type:null,clickable:false,disabled:false,selected:false,attributes:{}};
    const snapshot:CourseSurfaceSnapshot={capture_id:'before',url:'https://study.zhihuishu.com/course?courseId=77',title:'课程',native:false,visible_text:'00:01',elements:[element,{...element,element_id:'caption',parent_id:'player',tag:'div',classes:['vjs-text-track-display'],text:'字幕内容'}]};
    const fingerprint=courseSurfaceFingerprint(snapshot);
    expect(courseSurfaceFingerprint({...snapshot,capture_id:'after',visible_text:'00:02',intent:'task',elements:[element,{...snapshot.elements[1]!,element_id:'another-caption',text:'下一段字幕'}]})).toBe(fingerprint);
    expect(courseSurfaceFingerprint({...snapshot,elements:[...snapshot.elements,{...element,element_id:'popup',tag:'button',text:'提交答案',clickable:true}]})).not.toBe(fingerprint);
    expect(courseSurfaceFingerprint({...snapshot,elements:[...snapshot.elements,{...element,element_id:'record',tag:'span',text:'任务已完成'}]})).not.toBe(fingerprint);
  });
});
