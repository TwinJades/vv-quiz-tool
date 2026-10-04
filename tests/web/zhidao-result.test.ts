// @vitest-environment happy-dom
import {describe,expect,it} from 'vitest';
import {Window} from 'happy-dom';
import {readZhidaoResult,ZhidaoSubmissionReceipt} from '../../src/web/zhidao-result';
import {readZhidaoNavigation,resolveZhidaoReportReturn} from '../../src/web/zhidao-navigation';

function fixture(){
  const w=new Window({url:'https://ai-smart-course-student-pro.zhihuishu.com/point/101/201/301/401/501'});
  const d=w.document as unknown as Document;
  d.body.innerHTML=`<div class="point"><div class="backup"><div class="backup-title">本地知识点</div></div><div class="point-main"><div class="line1"><div class="line1-left"><div class="charts-label-rate">99%</div><div class="best-result">最好成绩100%</div><div class="line1-count"><div><div class="line1-count-total"><div class="line1-count-total-title">总题数</div><div class="line1-count-total-num">3</div></div><div class="line1-count-total"><div class="line1-count-total-title">已答对</div><div class="line1-count-total-num">1</div></div></div><div class="line1-count-link">查看作答记录与解析</div></div></div></div></div><div class="recommendation">参考答案：不应读取</div></div>`;
  return d;
}
describe('observed knowledge-practice result and parent receipt',()=>{
  it('binds a receipt to the public point/context parameters and rejects ambiguous parameters',()=>{
    const result=readZhidaoResult(fixture())!,receipt=new ZhidaoSubmissionReceipt();
    const route='https://studentexamcomh5.zhihuishu.com/studentReviewTestOrExam/301/1/1/101/opaque';
    receipt.refresh(route+'?pointId=401&classId=501',3,'s','o','f');expect(receipt.arm('s','o','f')).toBe(true);
    expect(receipt.reconcile({...result,point_id:'402'})).toBeNull();expect(receipt.reconcile({...result,context_id:'502'})).toBeNull();
    expect(receipt.reconcile(result)).not.toBeNull();
    const duplicate=new ZhidaoSubmissionReceipt();duplicate.refresh(route+'?pointId=401&pointId=402',3,'s','o','f');
    expect(duplicate.arm('s','o','f')).toBe(false);
  });
  it('resolves the actual result back icon rather than its non-clicking parent and rejects stale identity',()=>{
    const d=fixture();const icon=d.createElement('div');icon.className='backup-icon';d.querySelector('.backup')!.prepend(icon);
    const expected=readZhidaoNavigation(d)!;
    expect(resolveZhidaoReportReturn(d,expected)).toBe(icon);
    expect(()=>resolveZhidaoReportReturn(d,{...expected,point_id:'402'})).toThrow(/已改变/);
    icon.style.display='none';expect(()=>resolveZhidaoReportReturn(d,expected)).toThrow(/不可用/);
  });
  it('reads only public counts and keeps mastery, retry and passing separate',()=>{
    expect(readZhidaoResult(fixture())).toEqual({course_id:'101',exercise_id:'301',point_id:'401',context_id:'501',title:'本地知识点',total:3,correct:1,submission:'unknown',passed:null});
  });
  it('rejects ambiguous counts and invalid totals',()=>{
    const d=fixture();d.querySelectorAll('.line1-count-total-num')[1]!.textContent='4';expect(readZhidaoResult(d)).toBeNull();
    d.querySelectorAll('.line1-count-total-num')[1]!.textContent='1';d.querySelector('.line1-count')!.append(d.querySelector('.line1-count-total')!.cloneNode(true));expect(readZhidaoResult(d)).toBeNull();
  });
  it('never treats an old report or a different course/exercise as the current submission',()=>{
    const receipt=new ZhidaoSubmissionReceipt(),result=readZhidaoResult(fixture())!;
    expect(receipt.reconcile(result)).toBeNull();
    receipt.refresh('https://studentexamcomh5.zhihuishu.com/studentReviewTestOrExam/301/1/1/101/opaque',3,'session','obs','fingerprint');
    expect(receipt.reconcile(result)).toBeNull();expect(receipt.arm('other','obs','fingerprint')).toBe(false);
    expect(receipt.arm('session','obs','fingerprint')).toBe(true);expect(receipt.arm('session','obs','fingerprint')).toBe(false);
    expect(receipt.reconcile({...result,exercise_id:'302'})).toBeNull();expect(receipt.reconcile({...result,course_id:'102'})).toBeNull();
    expect(receipt.reconcile({...result,total:4})).toBeNull();expect(receipt.reconcile(result)).toMatchObject({visible_score:'答对 1/3',observation_id:'obs'});
  });
  it('preserves the pending lease through navigation and releases only an explicitly failed action',()=>{
    const receipt=new ZhidaoSubmissionReceipt();receipt.refresh('https://studentexamcomh5.zhihuishu.com/studentReviewTestOrExam/301/1/1/101/opaque',3,'s','o','f');receipt.arm('s','o','f');
    receipt.refresh('https://other.invalid',0,'s','different','different');expect(receipt.awaiting).toBe(true);expect(receipt.reconcile(readZhidaoResult(fixture()))).not.toBeNull();
    receipt.rejectFailedAction();expect(receipt.awaiting).toBe(false);expect(receipt.reconcile(readZhidaoResult(fixture()))).toBeNull();
  });
});
