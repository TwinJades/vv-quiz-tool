import { describe, expect, it } from 'vitest';
import { describeNotice, t } from '../../src/extension/ui-language';
import { SessionAttentionNotifications } from '../../src/extension/attention-notifications';

describe('interface languages', () => {
  it('explains budget preflight and stopping in both languages', () => {
    expect(describeNotice('Model call limit of 1 has been reached.', 'zh-CN').text).toBe('本场模型调用额度（1 次）不足以启动下一次请求，运行已暂停。');
    expect(describeNotice('Model call limit of 3 has been reached.', 'en').text).toBe('The session model call budget (3 calls) cannot cover the next request. Execution is paused.');
    expect(describeNotice('Stopped by user.', 'zh-CN').text).toBe('已按用户要求停止。');
    expect(describeNotice('Stopped by user.', 'en').text).toBe('Stopped by user.');
  });
  it('explains an already graded question before another model request in both languages', () => {
    const message = 'The current question has already been graded. Open an unanswered question on the page before continuing.';
    expect(describeNotice(message, 'zh-CN').text).toBe('当前题目已经评分，请在网页进入未作答题目后继续。');
    expect(describeNotice(message, 'en').text).toBe('The question has been graded. Open an unanswered question on the page before continuing.');
  });
  it('explains a graded question without a retry button in both languages', () => {
    const message = 'The graded question has no available retry control. No new answer was requested.';
    expect(describeNotice(message, 'zh-CN').text).toBe('当前题目已经评分，网页没有提供重试按钮，运行已暂停。');
    expect(describeNotice(message, 'en').text).toBe('The question has been graded and the page has no retry button. The session is paused.');
  });
  it('explains semantic validation failures in each language and preserves diagnostics', () => {
    const message='SEMANTIC_UNCERTAIN: initial model reading has no unambiguous locally mapped question regions.';
    expect(describeNotice(message,'zh-CN')).toEqual({text:'题目识别结果未通过实际网页控件验证。',details:message});
    expect(describeNotice(message,'en')).toEqual({text:'Question recognition did not pass validation against actual webpage controls.',details:message});
  });
  it('distinguishes missing model questions from unknown webpage elements', () => {
    expect(describeNotice('SEMANTIC_NO_QUESTIONS','zh-CN').text).toContain('没有返回');
    expect(describeNotice('SEMANTIC_UNKNOWN_ELEMENT','zh-CN').text).toContain('不一致');
    expect(describeNotice('SEMANTIC_MULTIPLE_SURFACES','en').text).toContain('multiple frames');
  });
  it('uses the selected language in system attention notifications', () => {
    expect(new SessionAttentionNotifications().next({state:'FAILED',strategy:'unattended',notice:'SEMANTIC_UNKNOWN_ELEMENT'},'en')).toEqual({
      title:'VV Session failed',message:'The returned question elements do not match the current page. Recognition must be repeated.'
    });
  });
  it('keeps unknown technical errors available with a readable explanation', () => {
    expect(describeNotice('Unexpected extension response','zh-CN')).toEqual({text:'操作未完成，请查看技术详情。',details:'Unexpected extension response'});
  });
  it('formats progress values and rejects missing translations', () => {
    expect(t('处理 {{title}}',{title:'Question 3'},'en')).toBe('Processing Question 3');
    expect(()=>t('missing.translation')).toThrow('UI_TRANSLATION_MISSING');
  });
  it('保留课程具体问题，并解释页面变化和默认范围',()=>{
    const reason='课时测验的平台记录尚未确认。';
    expect(describeNotice(reason,'zh-CN')).toEqual({text:reason});
    expect(describeNotice(reason,'en').details).toBe(reason);
    expect(describeNotice('PAGE_CHANGED: document identity changed','zh-CN').text).toBe('课程页面已经变化，请重新核验当前任务。');
    expect(t('全部未完成课时',{},'en')).toBe('All unfinished lessons');
  });
});
