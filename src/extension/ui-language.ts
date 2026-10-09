import { createInstance } from 'i18next';
import { STATE_LABELS, UI_TRANSLATIONS } from './ui-translations';

export type UiLanguage = 'zh-CN' | 'en';
export const UI_LANGUAGE_KEY = 'vv-ui-language';
const notices = new WeakMap<HTMLElement, {message:string;text:string}>();
const chinese = Object.fromEntries(Object.keys(UI_TRANSLATIONS).map(key => [key, key]));
for (const [state, label] of Object.entries(STATE_LABELS)) chinese[`state.${state}`] = label;
const translations = createInstance();
void translations.init({ lng:'zh-CN', supportedLngs:['zh-CN','en'], fallbackLng:false, keySeparator:false, nsSeparator:false,
  initAsync:false, interpolation:{escapeValue:false}, resources:{'zh-CN':{translation:chinese},en:{translation:UI_TRANSLATIONS}} });

export function t(key: string, values: Record<string, string | number> = {}, language?: UiLanguage): string {
  if (!translations.isInitialized || !translations.exists(key, {lng:language ?? translations.language})) throw new Error(`UI_TRANSLATION_MISSING: ${key}`);
  return String(translations.t(key, {...values,...(language ? {lng:language} : {})}));
}

export async function readUiLanguage(): Promise<UiLanguage> {
  const stored = await chrome.storage.local.get(UI_LANGUAGE_KEY);
  return stored[UI_LANGUAGE_KEY] === 'en' ? 'en' : 'zh-CN';
}

export function hasUiTranslation(key: string): boolean { return Object.hasOwn(UI_TRANSLATIONS,key); }

export function stateLabel(state: string): string {
  if (state.startsWith('处理 ')) return t('处理 {{title}}',{title:state.slice(3)});
  return STATE_LABELS[state] ? t(`state.${state}`) : state;
}

export function describeNotice(message: string, language?: UiLanguage): {text: string; details?: string} {
  if (!message) return {text:''};
  if (translations.exists(message, {lng:language ?? translations.language})) return {text:t(message, {}, language)};
  if (message === 'Paused by user.') return {text:t('已按用户要求暂停。', {}, language)};
  if (message === 'Stopped by user.') return {text:t('已按用户要求停止。', {}, language)};
  const budgetLimit = /^Model call limit of (\d+) has been reached\.$/.exec(message);
  if (budgetLimit) return {text:t('本场模型调用额度（{{limit}} 次）不足以启动下一次请求，运行已暂停。', {limit:budgetLimit[1]!}, language)};
  if (message === 'Answer retries were exhausted.') return {text:t('重试次数已经用完，当前运行已经暂停。', {}, language)};
  if (message === 'The graded question has no available retry control. No new answer was requested.')
    return {text:t('当前题目已经评分，网页没有提供重试按钮，运行已暂停。', {}, language)};
  if (message === 'The current question has already been graded. Open an unanswered question on the page before continuing.')
    return {text:t('当前题目已经评分，请在网页进入未作答题目后继续。', {}, language)};
  if(/^[\u4e00-\u9fff]/.test(message)&&/课程|课时|知识点|视频|测验|弹题|目录|断点/.test(message))return (language??translations.language)==='zh-CN'?{text:message}:{text:t('课程任务需要处理。',{},language),details:message};
  const key = /SEMANTIC_NO_QUESTIONS/.test(message) ? '模型没有返回当前可答题目，请检查页面内容并重新识别。'
    : /PAGE_CHANGED/.test(message) ? '课程页面已经变化，请重新核验当前任务。'
    : /SEMANTIC_UNKNOWN_ELEMENT/.test(message) ? '模型返回的题目元素与当前网页不一致，需要重新识别。'
    : /SEMANTIC_MULTIPLE_SURFACES/.test(message) ? '模型把题目识别到多个页面框架，当前答题区域尚未确定。'
    : /requires screenshot mode/.test(message) ? '当前页面需要截图识别，请使用截图模式。'
    : /SEMANTIC_|separation_uncertain/.test(message) ? '题目识别结果未通过实际网页控件验证。'
    : /VISUAL_/.test(message) ? '当前页面截图或视觉操作尚未完成，请检查页面授权和浏览器连接。'
    : /USER_INTERACTION/.test(message) ? '检测到人工操作，自动运行已经暂停。'
    : /HARD_BLOCKER|captcha|proctor|login/i.test(message) ? '当前页面存在登录、验证码或监考提示，需要人工处理。'
    : /permission|Cannot access/i.test(message) ? '当前网页权限不足，请授权该网站后继续。'
    : /SolverProvider|Provider|quota|429|HTTP|model call|authentication|CAPABILITY_MISMATCH/i.test(message) ? '模型服务请求未完成，请检查接口、授权和额度。'
    : /question_not_found|readiness_timeout/.test(message) ? '页面题目识别尚未完成，请确认当前页面已进入答题状态。'
    : /stage=|verification|fingerprint|target|submission|submit|advance/i.test(message) ? '网页操作或结果核验未完成，请查看技术详情。'
    : '操作未完成，请查看技术详情。';
  return {text:t(key, {}, language),details:message};
}

export function showNotice(element: HTMLElement, message: string): void {
  const notice = describeNotice(message);
  element.textContent = notice.text;
  if (message) notices.set(element,{message,text:notice.text});
  else notices.delete(element);
  element.toggleAttribute('data-vv-notice',Boolean(message));
  const previous = element.nextElementSibling;
  if (previous?.getAttribute('data-notice-details') === element.id) previous.remove();
  if (!notice.details) return;
  const details = document.createElement('details');
  details.dataset.noticeDetails = element.id;
  const summary = document.createElement('summary'); summary.textContent = t('技术详情');
  const content = document.createElement('pre'); content.textContent = notice.details;
  details.append(summary, content); element.after(details);
}

export async function initializeUiLanguage(onChange: () => void | Promise<void>): Promise<void> {
  const bindings: Array<{node:Text;key:string;prefix:string;suffix:string}> = [];
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
  for (let node=walker.nextNode();node;node=walker.nextNode()) {
    if (node.parentElement?.closest('script,style,textarea')) continue;
    const value=node.textContent ?? '', key=value.trim();
    if (!key || !Object.hasOwn(UI_TRANSLATIONS,key)) continue;
    bindings.push({node:node as Text,key,prefix:value.slice(0,value.indexOf(key)),suffix:value.slice(value.indexOf(key)+key.length)});
  }
  const attributes: Array<{element:Element;name:string;key:string}> = [];
  for (const element of document.querySelectorAll('[aria-label],[placeholder],[title]')) {
    for (const name of ['aria-label','placeholder','title']) {
      const key=element.getAttribute(name);
      if (key && Object.hasOwn(UI_TRANSLATIONS,key)) attributes.push({element,name,key});
    }
  }
  const languageBar=document.createElement('div'); languageBar.className='language-control';
  languageBar.setAttribute('role','group'); languageBar.setAttribute('aria-label','Language / 语言');
  const button=document.createElement('button'); button.type='button'; button.id='ui-language-toggle';
  button.addEventListener('click',()=>{
    const language:UiLanguage=document.documentElement.lang==='en'?'zh-CN':'en';
    void chrome.storage.local.set({[UI_LANGUAGE_KEY]:language});
  });
  languageBar.append(button);
  const languageSlot = document.querySelector('#popup-language-slot, #options-language-slot');
  if (languageSlot) languageSlot.append(languageBar);
  else document.querySelector('main')!.prepend(languageBar);
  const change=async(language:UiLanguage):Promise<void>=>{
    await translations.changeLanguage(language); document.documentElement.lang=language;
    button.textContent=language==='en'?'CN':'EN';
    button.setAttribute('aria-label',language==='en'?'切换到中文':'Switch to English');
    button.title=language==='en'?'切换到中文':'Switch to English';
    for (const element of document.querySelectorAll<HTMLElement>('[data-vv-notice]')) {
      const notice=notices.get(element);if(!notice)continue;
      if (element.isConnected && element.textContent === notice.text) showNotice(element,notice.message);
      else notices.delete(element);
    }
    for (const binding of bindings) if (binding.node.isConnected) binding.node.textContent=binding.prefix+t(binding.key)+binding.suffix;
    for (const attribute of attributes) if (attribute.element.isConnected) attribute.element.setAttribute(attribute.name,t(attribute.key));
    await onChange();
  };
  chrome.storage.onChanged.addListener((changes,area)=>{
    if (area==='local' && changes[UI_LANGUAGE_KEY]) void change(changes[UI_LANGUAGE_KEY].newValue==='en'?'en':'zh-CN');
  });
  await change(await readUiLanguage());
}
