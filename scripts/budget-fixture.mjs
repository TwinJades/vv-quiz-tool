// Actual HTTP requests and page actions in owned hidden MV3 test profiles.
export function budgetFixtureHtml(total) {
  if (!Number.isInteger(total) || total < 1 || total > 301) throw new Error('Invalid budget fixture size');
  return `<!doctype html><title>VV call-budget fixture</title><main data-total-questions="${total}"></main><script>
    window.answers=0;window.checks=0;window.current=1;window.completed=false;
    function render(){document.querySelector('main').innerHTML='<fieldset><legend>Question '+window.current+' of ${total}: Choose Alpha</legend><label><input type="radio" name="q" value="a">Alpha</label><label><input type="radio" name="q" value="b">Beta</label><button id="check">Check</button></fieldset>';document.querySelector('#check').onclick=()=>{window.checks++;if(!document.querySelector('input[value=a]').checked)return;window.answers++;window.current++;if(window.current>${total}){window.completed=true;document.querySelector('main').innerHTML='You got ${total} out of ${total} points';}else render();};}render();
  </script>`;
}

export async function runBudgetCases({ name, port, profiles, control, cdp, extensionId, result, directory, writeFile, resolve, requests, notices }) {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const send = async request => {
    const response = await control.evaluate(`chrome.runtime.sendMessage(${JSON.stringify(request)})`);
    if (!response.ok) throw new Error(response.error);
    return response.result;
  };
  const panelId = (await cdp.send('Target.createTarget', { url: `chrome-extension://${extensionId}/tasks.html` })).targetId;
  await pause(200);
  result.budget = [];
  const cases = ['default', 'retry'].map(kind => ({ id: `${kind}-unattended`, kind, strategy: 'unattended' }));
  await Promise.all(cases.map(async ({ id, kind, strategy }, index) => {
    const item = { id, kind, strategy, passed: false, error: null, request_limit_omitted: kind === 'default' };
    result.budget.push(item);
    try {
      const limit = kind === 'default' ? 300 : 3;
      const profile = { ...profiles.find(p => p.provider_type === 'openai_compatible'), provider_profile_id: `budget-${id}`, secret_ref: `budget-${id}`, base_url: `http://127.0.0.1:${port}/${name}/openai_compatible/budget-${id}/v1` };
      await control.evaluate(`chrome.storage.local.set(${JSON.stringify({ [`provider-profile:${profile.provider_profile_id}`]: profile, [`provider-secret:${profile.secret_ref}`]: 'local-fixture-only' })})`);
      const url = `http://${index % 2 ? '127.0.0.1' : 'localhost'}:${port}/budget/${kind === 'default' ? 301 : 1}/${name}/${id}`;
      const tab = await control.evaluate(`chrome.tabs.create({url:${JSON.stringify(url)},active:false})`);
      item.tab_id = tab.id; item.url = url;
      await pause(200);
      const request = { type: 'VV_START_SESSION', tab_id: tab.id, provider_profile_id: profile.provider_profile_id, model_id: profile.model_catalog.models[0], strategy, observation_input_mode: 'structured', ...(kind === 'retry' ? { model_call_limit: limit } : {}) };
      item.started = await send(request);
      if (item.started.model_calls.limit !== limit) throw new Error('Actual session call limit differs from default/custom limit');
      const count = () => requests.filter(request => request.url?.includes(`/${name}/`) && request.url?.includes(`/budget-${id}/`)).length;
      const read = () => send({ type: 'VV_GET_SESSION', tab_id: tab.id });
      const settle = async previousObservations => {
        const deadline = Date.now() + 600000;
        let lastLogged = 0;
        do {
          item.snapshot = await read();
          const observed = item.snapshot?.steps?.find(step => step.step === 'observe_session')?.calls ?? 0;
          const panel = await send({ type: 'VV_GET_TASKS' });
          if (item.snapshot?.state === 'PAUSED' && observed > previousObservations && !panel.running.includes(tab.id) && !panel.queued.includes(tab.id)) return;
          if (['FAILED', 'COMPLETE', 'CANCELLED'].includes(item.snapshot?.state)) throw new Error(`Unexpected terminal state ${item.snapshot.state}`);
          if (count() >= lastLogged + 50) { lastLogged = count(); console.log(name, id, 'actual requests', lastLogged); }
          await pause(200);
        } while (Date.now() < deadline);
        throw new Error('Budget observation deadline; preserve report and inspect same process');
      };
      await settle(-1);
      const first = item.snapshot;
      item.requests_before_resume = count();
      if (first.model_calls.used !== limit || count() !== limit) throw new Error('Failed requests or default boundary were not counted exactly');
      if (kind === 'default' && !/model call limit/i.test(first.notice ?? '')) throw new Error('Default-budget stop reason missing');
      if (kind === 'retry' && !/Provider|unavailable/i.test(first.notice ?? '')) throw new Error('Network failure did not pause with a provider stop reason');
      const previousObservations = first.steps?.find(step => step.step === 'observe_session')?.calls ?? 0;
      await send({ type: 'VV_RESUME_SESSION', tab_id: tab.id });
      await settle(previousObservations);
      item.requests_after_resume = count();
      const [page] = await control.evaluate(`chrome.scripting.executeScript({target:{tabId:${tab.id}},world:'MAIN',func:()=>({answers:window.answers,checks:window.checks,current:window.current,completed:window.completed,selected:document.querySelector('input[value=a]')?.checked,text:document.body.innerText})})`);
      item.website = page.result;
      item.notices = (await control.evaluate(notices)).filter(notice => notice.id === `vv-${tab.id}`);
      if (count() !== limit || item.snapshot.model_calls.used !== limit || !/model call limit/i.test(item.snapshot.notice ?? '')) throw new Error('Resume consumed past the exhausted budget');
      const answered = kind === 'default' ? 300 : 0;
      if (item.snapshot.progress.answered !== answered || item.website.answers !== answered || item.website.checks !== answered || item.website.current !== answered + 1 || item.website.completed || item.website.selected !== false) throw new Error('Budget exhaustion guessed, submitted or edited the next unanswered question');
      const beforeClear = await control.evaluate(`chrome.storage.session.get('vv-session-snapshot:${tab.id}')`);
      if (!Object.keys(beforeClear).length) throw new Error('Paused summary not available before clear');
      await send({ type: 'VV_CLEAR_SESSION', tab_id: tab.id });
      if (await read()) throw new Error('Cleared budget session reappeared');
      const afterClear = await control.evaluate(`chrome.storage.session.get('vv-session-snapshot:${tab.id}')`);
      if (Object.keys(afterClear).length) throw new Error('Budget session snapshot persisted after clear');
      item.session_cleared = true;
      const { targetInfos } = await cdp.send('Target.getTargets');
      const target = targetInfos.find(target => target.type === 'page' && target.url === url);
      if (target) {
        const ownedPage = await cdp.attach(target.targetId);
        const image = await ownedPage.send('Page.captureScreenshot', { format: 'png' });
        await writeFile(resolve(directory, `${name}-budget-${id}.png`), Buffer.from(image.data, 'base64'));
      }
      item.passed = true;
    } catch (error) { item.error = error.message; }
    console.log(name, 'budget', id, 'passed', item.passed, 'error', item.error);
  }));
  await cdp.send('Target.closeTarget', { targetId: panelId });
}
