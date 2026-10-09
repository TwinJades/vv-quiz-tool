import { CdpClient, cdpJson } from './cdp-client.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const reviewedPaths = new Set([
  '/form-library/examples/make-quiz-javascript/reactjs',
  '/form-library/examples/create-quiz-with-immediate-results/reactjs',
]);

async function click(page, expression) {
  const point = await page.evaluate(expression);
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
}

export async function preparePublicTimedSurvey(site, port) {
  const url = new URL(site.url);
  if (url.origin !== 'https://surveyjs.io' || !reviewedPaths.has(url.pathname))
    throw new Error('Unknown public timed SurveyJS bootstrap');
  let target;
  for (let attempt = 0; attempt < 100; attempt++) {
    target = (await cdpJson(port, '/json/list')).find(item => item.type === 'page' && item.url === site.url);
    if (target) break;
    await pause(100);
  }
  if (!target) throw new Error('Owned timed demo tab did not navigate');
  const page = new CdpClient(target.webSocketDebuggerUrl);
  let prepared = false;
  try {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    const intro = await page.evaluate('document.body.innerText');
    if (!intro.includes('Enter your name below and click Start Quiz to begin.') ||
        !intro.includes('10 seconds for every question and 25 seconds to end the quiz.'))
      throw new Error('Reviewed timed demo introduction changed');

    const cookie = await page.evaluate(`(()=>{const buttons=[...document.querySelectorAll('button,a,[role=button]')].filter(e=>/^Cookie Settings$/i.test(e.textContent.trim())&&e.getBoundingClientRect().width>0);if(buttons.length!==1)return null;const e=buttons[0],r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);return hit===e||e.contains(hit)?{x,y}:null;})()`);
    let cookieChoicesConfirmed = false;
    if (cookie) {
      await click(page, `(()=>(${JSON.stringify(cookie)}))()`);
      await pause(300);
      const choices = await page.evaluate(`(()=>{const list=document.querySelector('.v2-class---popup__cookies-settings-list');return list?[...list.children].map(row=>({name:row.querySelector('h3')?.textContent.trim(),checked:row.querySelector('input[type=checkbox]')?.checked,disabled:row.querySelector('input[type=checkbox]')?.disabled})):null;})()`);
      if (!choices || choices.length !== 3 ||
          !choices.some(item => item.name === 'Functional' && item.checked && item.disabled) ||
          !choices.some(item => item.name === 'Performance' && item.checked && item.disabled) ||
          !choices.some(item => item.name === 'Targeting' && !item.checked && !item.disabled))
        throw new Error('Public cookie choices differ from reviewed required-only defaults');
      await click(page, `(()=>{const buttons=[...document.querySelectorAll('button,a,[role=button]')].filter(e=>/^Confirm My Choices$/i.test(e.textContent.trim())&&e.getBoundingClientRect().width>0);if(buttons.length!==1)throw new Error('Cookie confirmation is ambiguous');const e=buttons[0],r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);if(hit!==e&&!e.contains(hit))throw new Error('Cookie confirmation is obstructed');return{x,y};})()`);
      cookieChoicesConfirmed = true;
      await pause(300);
    }

    await click(page, `(()=>{const fields=[...document.querySelectorAll('input[type=text]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.disabled&&!/Type to filter the list/i.test(e.placeholder)});if(fields.length!==1||fields[0].value)throw new Error('Synthetic test-name field is ambiguous');const e=fields[0],r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);if(hit!==e)throw new Error('Synthetic test-name field is obstructed');return{x,y};})()`);
    await page.send('Input.insertText', { text: 'VV Acceptance Test' });
    if (!await page.evaluate(`[...document.querySelectorAll('input[type=text]')].filter(e=>e.value==='VV Acceptance Test').length===1`))
      throw new Error('Synthetic test name was not applied');
    await click(page, `(()=>{const buttons=[...document.querySelectorAll('button')].filter(e=>/^Start Quiz$/i.test(e.textContent.trim())&&!e.disabled&&e.getBoundingClientRect().width>0);if(buttons.length!==1)throw new Error('Public timed Start Quiz is ambiguous');const e=buttons[0];e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);if(hit!==e&&!e.contains(hit))throw new Error('Public timed Start Quiz is obstructed');return{x,y};})()`);
    await pause(250);
    const started = await page.evaluate(`({timer:document.querySelector('.sd-timer')?.innerText??null,question:document.querySelector('.sd-body--with-timer')?.innerText?.slice(0,300)??null})`);
    if (!started.timer?.includes('0:25') || !started.question)
      throw new Error('Public timed quiz did not start with the reviewed timer');
    prepared = true;
    return { page, evidence: { synthetic_test_name: 'VV Acceptance Test', cookie_choices_confirmed: cookieChoicesConfirmed,
      timer_at_start: started.timer, question_at_start: started.question, answers_sent_before_vv: 0,
      desktop_focus_changed: false, simulated_focus: true } };
  } finally {
    if (!prepared) page.close();
  }
}
