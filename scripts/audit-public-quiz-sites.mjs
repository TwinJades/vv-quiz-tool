// Read-only inventory in an owned hidden browser. Never loads user profiles,
// clicks controls, starts a model or exposes embedded correct-answer content.
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CdpClient, cdpJson } from "./cdp-client.mjs";

const root=resolve(import.meta.dirname,"..");
const directory=resolve(root,".browser-regression-runtime",`site-audit-${new Date().toISOString().replaceAll(":","-")}`);
await mkdir(directory,{recursive:true});
const report={directory,headless:true,parallel:true,external_model_calls:0,sites:[],errors:[]};
const waitCanvas=process.argv.includes('--wait-canvas');
const waitDemo=process.argv.includes('--wait-demo');
const startIspring=process.argv.includes('--start-ispring');
const startSurvey=process.argv.includes('--start-survey');
const watchSurvey=process.argv.includes('--watch-survey');
const syntheticSurveyName=process.argv.includes('--synthetic-survey-name');
const catalogWalk=process.argv.includes('--catalog-walk');
const catalogCandidates=catalogWalk||process.argv.includes('--catalog-candidates');
const auditedCandidates=new Set();
const auditedCatalogPages=new Set();
const renderProbe=waitCanvas||waitDemo||startIspring||startSurvey;
const siteArguments=process.argv.slice(2).filter(argument=>!['--wait-canvas','--wait-demo','--start-ispring','--start-survey','--watch-survey','--synthetic-survey-name','--catalog-candidates','--catalog-walk'].includes(argument));
const urls=siteArguments.length?siteArguments:[
  "https://testmoz.com/1",
  "https://h5p.open.ubc.ca/h5p-examples/quiz-question-set/",
  "https://h5p.psu.edu/interactive-stimului/respond-to-questions-of-various-types/",
];
if(urls.length<2||urls.some(url=>!/^https?:\/\//.test(url)))throw new Error("Audit needs at least two public HTTP(S) sites");
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const profile=resolve(directory,"profile");
const child=spawn(resolve(root,".browser-regression-runtime/chrome-cft/chrome-win64/chrome.exe"),[
  "--headless=new","--remote-debugging-port=0",`--user-data-dir=${profile}`,"--no-first-run","--no-default-browser-check",
  "--disable-gpu","--no-sandbox","about:blank"],{windowsHide:true,stdio:"ignore"});
child.on("error",error=>report.errors.push(error.message));
let browser;
const inspect=`(()=>{
  const visible=e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=="hidden"&&s.display!=="none"};
  const inventories=[];
  const accessBlocked=/Login Required|Please log in to access this activity|403 ERROR|The request could not be satisfied|Verify you are human|Checking your browser|Attention Required.*Cloudflare/i.test(document.body?.innerText??'');
  function inventory(win){
    const contents=win.H5PIntegration?.contents;
    for(const [id,value]of Object.entries(contents??{})){
      let data;try{data=JSON.parse(value.jsonContent)}catch{continue}
      if(inventories.some(item=>item.id===id&&item.library===value.library))continue;
      const questions=/QuestionSet/.test(value.library??'')?(data.questions??data.content?.questions??[]):[{library:value.library,params:data}];
      const kinds={single:0,multi:0,fill:0,unknown_choice:0,unsupported:0};const libraries=[];
      const hasImage=object=>typeof object==='string'?/<img\\b[^>]*\\bsrc\\s*=/i.test(object):object&&typeof object==="object"&&(Boolean(object.path&&/\\.(?:png|jpe?g|gif|webp|svg)(?:\\?|$)/i.test(object.path))||Object.values(object).some(hasImage));
      for(const q of questions){const library=q.library??q.content?.library??"unknown",p=q.params??q.content?.params??{};libraries.push(library);
        if(/Blanks/.test(library))kinds.fill++;
        else if(/SingleChoiceSet|TrueFalse/.test(library))kinds.single++;
        else if(/MultiChoice/.test(library)){
          const type=p.behaviour?.type??"auto";
          if(type==="single")kinds.single++;
          else if(type==="multi")kinds.multi++;
          else kinds.unknown_choice++;
        }
        else if(/ImageChoice/.test(library)){if(p.behaviour?.singleAnswer===false||p.behaviour?.type==="multi")kinds.multi++;else kinds.single++}
        else kinds.unsupported++;
      }
      inventories.push({id,library:value.library,question_count:questions.length,kinds,libraries,contains_image:Boolean(hasImage(data)),contains_question_image:questions.some(q=>Boolean(hasImage(q.params??q.content?.params??{})))});
    }
  }
  if(!accessBlocked){inventory(window);for(const f of document.querySelectorAll("iframe")){try{inventory(f.contentWindow)}catch{}}}
  const radios=[...document.querySelectorAll('input[type=radio][name]')].filter(visible);
  const names=[...new Set(radios.map(e=>e.name))];
  const radioGroups=names.slice(0,2).map(name=>{
    const controls=radios.filter(e=>e.name===name);let node=controls[0]?.parentElement;
    while(node&&!controls.every(e=>node.contains(e)))node=node.parentElement;
    const ancestors=[];for(let level=0;node&&level<4;level++,node=node.parentElement)ancestors.push({tag:node.tagName,class:node.className,text:node.innerText?.slice(0,450),radio_count:node.querySelectorAll('input[type=radio]').length});
    return {name,count:controls.length,ancestors};
  });
  return {url:location.href,title:document.title,visibility:document.visibilityState,
    text:document.body?.innerText.slice(0,2500),inventories,access_blocked:accessBlocked,
    related_links:[...document.querySelectorAll('a[href]')].filter(a=>(/quiz|question set|questionset|paleolithic/i.test(a.textContent)||/Question Set/.test(a.closest('tr')?.textContent??'')||(location.hostname==='studio.libretexts.org'&&location.pathname==='/library'&&a.hostname==='studio.libretexts.org'&&a.pathname.startsWith('/h5p/')&&!a.pathname.includes('embed')))&&/^https?:/.test(a.href)).slice(0,60).map(a=>({text:a.textContent.trim().slice(0,150),url:a.href})),
    catalog_question_set_links:location.hostname==='studio.libretexts.org'&&location.pathname==='/library'?[...document.querySelectorAll('.item-text-wrap')].filter(e=>e.innerText.includes(' Question Set by ')).map(e=>e.querySelector('h3.item-title a[href]')?.href).filter(Boolean):undefined,
    pagination_links:[...document.querySelectorAll('a[href]')].filter(a=>/[?&](?:page|hpage)=/.test(a.href)).map(a=>({text:a.textContent.trim().slice(0,80),url:a.href})),
    timer_elements:[...document.querySelectorAll('[role=timer], [class*=timer], [class*=countdown]')].filter(visible).slice(0,12).map(e=>({tag:e.tagName,class:e.className,role:e.getAttribute('role'),text:e.innerText?.slice(0,250)})),
    public_catalog_filters:['h5pstudio.ecampusontario.ca','studio.libretexts.org'].includes(location.hostname)?[...document.querySelectorAll('form')].map(form=>({action:form.action,method:form.method,selects:[...form.querySelectorAll('select')].map(select=>({name:select.name,options:[...select.options].map(option=>({value:option.value,text:option.textContent}))})),type_options:[...form.querySelectorAll('input[type=radio][name=type]')].map(input=>({value:input.value,text:input.labels?.[0]?.textContent?.trim()??null})),text_inputs:[...form.querySelectorAll('input[type=text]')].map(input=>({name:input.name,placeholder:input.placeholder}))})):undefined,
    active_catalog_type:location.hostname==='studio.libretexts.org'&&location.pathname==='/library'?document.querySelector('input[type=radio][name=type]:checked')?.value??null:undefined,
    iframes:[...document.querySelectorAll("iframe")].map(f=>f.src).filter(u=>/^https?:/.test(u)),
    controls:[...document.querySelectorAll("input,select,button,textarea")].filter(visible).slice(0,35).map(e=>({tag:e.tagName,type:e.type,name:e.name,label:e.labels?.[0]?.textContent?.trim()??e.textContent?.trim(),placeholder:e.placeholder})),
    question_roots:document.querySelectorAll("fieldset,[data-vv-question],.h5p-question").length,
    radio_group_count:names.length,radio_groups:radioGroups,
    canvases:document.querySelectorAll("canvas").length};
})()`;
async function audit(url,index,embedded=false){
  if(catalogCandidates&&/^https:\/\/(?:h5pstudio\.ecampusontario\.ca\/content|studio\.libretexts\.org\/h5p)\/\d+$/.test(url)){
    if(auditedCandidates.has(url))return;
    auditedCandidates.add(url);
  }
  const item={url,embedded,error:null};report.sites.push(item);
  let diagnosticListener;
  let ownedTargetId;
  try{
    const {targetId}=await browser.send("Target.createTarget",{url:renderProbe?'about:blank':url,background:true});
    ownedTargetId=targetId;
    const page=await browser.attach(targetId);item.page=page;
    if(renderProbe) {
      item.runtime_errors=[];item.resource_failures=[];
      const paths=new Map();
      diagnosticListener=event=>{const message=JSON.parse(event.data);if(message.sessionId!==page.sessionId)return;
        if(message.method==='Network.requestWillBeSent'){const request=message.params;try{const parsed=new URL(request.request.url);paths.set(request.requestId,parsed.origin+parsed.pathname)}catch{}}
        if(message.method==='Network.loadingFailed'&&item.resource_failures.length<30)item.resource_failures.push({path:paths.get(message.params.requestId)??null,error:message.params.errorText,blocked:message.params.blockedReason??null});
        if(message.method==='Runtime.exceptionThrown'&&item.runtime_errors.length<20)item.runtime_errors.push((message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text).slice(0,400));
      };
      browser.socket.addEventListener('message',diagnosticListener);
      await page.send('Network.enable');await page.send('Runtime.enable');
      await page.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
      await page.send('Emulation.setFocusEmulationEnabled',{enabled:true});
      item.owned_rendering={width:1280,height:900,simulated_focus:true,desktop_focus_changed:false};
      await page.send('Page.navigate',{url});
    }
    const navigationDeadline=Date.now()+30000;
    while(Date.now()<navigationDeadline){
      const status=await page.evaluate("({url:location.href,ready:document.readyState})");
      if(/^https?:/.test(status.url)&&status.ready==="complete")break;
      await sleep(200);
    }
    await sleep(2000);
    if(waitDemo||startIspring||(waitCanvas&&await page.evaluate('document.querySelectorAll("canvas").length>0'))) {
      item.canvas_initial=await page.evaluate('({text:document.body?.innerText.slice(0,800),canvas:[...document.querySelectorAll("canvas")].map(canvas=>({width:canvas.width,height:canvas.height}))})');
      await sleep(45000);
      item.canvas_wait_ms=45000;
      item.resource_state=await page.evaluate('({ready:document.readyState,resources:performance.getEntriesByType("resource").slice(-40).map(resource=>({path:new URL(resource.name).origin+new URL(resource.name).pathname,type:resource.initiatorType,duration:Math.round(resource.duration)}))})');
    }
    if(startIspring){
      const parsed=new URL(url);
      if(parsed.hostname!=='cdn4.ispringsolutions.com'||!/^\/demos\/ispring-quizmaker\/(?:geometry-test|solar-system|london)\/index\.html$/.test(parsed.pathname))throw new Error('Public start probe is restricted to reviewed education demos');
      const point=await page.evaluate(`(()=>{if(!/Click the [“"]Start Quiz[”"] button to proceed/.test(document.body.innerText))throw new Error('Reviewed quiz introduction missing');const buttons=[...document.querySelectorAll('button')].filter(button=>{const r=button.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(button).visibility!=='hidden'&&!button.disabled});if(buttons.length!==1)throw new Error('Public start control ambiguous');const r=buttons[0].getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
      await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
      await sleep(5000);item.started_public_intro_only=true;
      const ax=await page.send('Accessibility.getFullAXTree');
      item.accessible_controls=ax.nodes.filter(node=>!node.ignored&&/radio|checkbox|textbox|button|combobox/.test(node.role?.value??'')).map(node=>({role:node.role?.value,name:node.name?.value,properties:node.properties?.filter(property=>['checked','disabled','required'].includes(property.name))}));
    }
    if(startSurvey){
      const parsed=new URL(url);
      if(parsed.hostname!=='surveyjs.io'||!/^\/form-library\/examples\/(?:make-quiz-javascript|create-quiz-with-immediate-results|create-a-scored-quiz)\/reactjs$/.test(parsed.pathname))throw new Error('Public start probe is restricted to reviewed SurveyJS demos');
      const cookiePoint=await page.evaluate(`(()=>{const buttons=[...document.querySelectorAll('button,a,[role=button]')].filter(e=>/^Cookie Settings$/i.test(e.textContent.trim())&&e.getBoundingClientRect().width>0);if(buttons.length!==1)return null;const e=buttons[0],r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;const hit=document.elementFromPoint(x,y);if(hit!==e&&!e.contains(hit))return null;return {x,y};})()`);
      if(cookiePoint){
        await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...cookiePoint});
        await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...cookiePoint});
        await sleep(300);item.cookie_settings_opened_only=true;
        const choices=await page.evaluate(`(()=>{const list=document.querySelector('.v2-class---popup__cookies-settings-list');if(!list)return null;return [...list.children].map(row=>({name:row.querySelector('h3')?.textContent.trim(),checked:row.querySelector('input[type=checkbox]')?.checked,disabled:row.querySelector('input[type=checkbox]')?.disabled}));})()`);
        item.cookie_choices=choices;
        if(!choices||choices.length!==3||!choices.some(c=>c.name==='Functional'&&c.checked&&c.disabled)||!choices.some(c=>c.name==='Performance'&&c.checked&&c.disabled)||!choices.some(c=>c.name==='Targeting'&&!c.checked&&!c.disabled))throw new Error('Cookie choices differ from the reviewed required-only defaults');
        const confirm=await page.evaluate(`(()=>{const buttons=[...document.querySelectorAll('button,a,[role=button]')].filter(e=>/^Confirm My Choices$/i.test(e.textContent.trim())&&e.getBoundingClientRect().width>0);if(buttons.length!==1)throw new Error('Cookie confirm control ambiguous');const e=buttons[0],r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;const hit=document.elementFromPoint(x,y);if(hit!==e&&!e.contains(hit))throw new Error('Cookie confirm control obstructed');return {x,y};})()`);
        await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...confirm});
        await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...confirm});
        await sleep(300);item.cookie_choices_confirmed=true;
      }
      if(syntheticSurveyName){
        if(!/Enter your name below and click Start Quiz to begin\./.test(await page.evaluate('document.body.innerText')))
          throw new Error('Reviewed demo name prompt is missing');
        const namePoint=await page.evaluate(`(()=>{const fields=[...document.querySelectorAll('input[type=text]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.disabled&&!/Type to filter the list/i.test(e.placeholder)});if(fields.length!==1||fields[0].value)throw new Error('Synthetic test-name field missing or ambiguous');const e=fields[0],r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);if(hit!==e)throw new Error('Synthetic test-name field obstructed');return{x,y};})()`);
        await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...namePoint});
        await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...namePoint});
        await page.send('Input.insertText',{text:'VV Acceptance Test'});
        if(!await page.evaluate(`(()=>[...document.querySelectorAll('input[type=text]')].filter(e=>e.value==='VV Acceptance Test').length===1)()`))
          throw new Error('Synthetic test name was not applied');
        item.synthetic_test_name_entered=true;
      }
      const point=await page.evaluate(`(()=>{const buttons=[...document.querySelectorAll('button,input[type=button],input[type=submit]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.disabled&&/^Start(?: Quiz)?$/i.test((e.textContent||e.value||'').trim())});if(buttons.length!==1)throw new Error('Reviewed quiz start control missing or ambiguous');const e=buttons[0];e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(document.elementFromPoint(x,y)!==e&&!e.contains(document.elementFromPoint(x,y)))throw new Error('Quiz start control obstructed');return {x,y};})()`);
      await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
      await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
      await sleep(700);item.started_public_intro_only=true;item.personal_information_entered=false;
    }
    item.state=await page.evaluate(inspect);
    // Visible markup and navigation only, including same-origin quiz frames.
    // Never inspect library state or solution/answer attributes for this probe.
    item.h5p_visible_dom=await page.evaluate(`(()=>{const docs=[document];for(let i=0;i<docs.length;i++)for(const f of docs[i].querySelectorAll('iframe')){try{if(f.contentDocument&&!docs.includes(f.contentDocument))docs.push(f.contentDocument);}catch{}}return docs.map(d=>{const view=d.defaultView;const visible=e=>{for(let p=e;p;p=p.parentElement){const s=view.getComputedStyle(p);if(p.hidden||p.getAttribute('aria-hidden')==='true'||s.display==='none'||s.visibility==='hidden')return false;}return true;};return {url:d.location.href,sets:[...d.querySelectorAll('.h5p-question-set,.questionset')].map(e=>({tag:e.tagName,class:e.className,visible:visible(e)})),navigation:[...d.querySelectorAll('[class*=h5p-question-next],[class*=progress-dot],[class*=h5p-question-finish],[class*=questionset-results]')].map(e=>({tag:e.tagName,class:e.className,role:e.getAttribute('role'),label:e.getAttribute('aria-label'),text:visible(e)?e.innerText?.slice(0,200):null,visible:visible(e)}))};}).filter(d=>d.sets.length||d.navigation.length);})()`);
    if(startSurvey){item.start_succeeded=item.state.radio_group_count>0;}
    if(startSurvey&&watchSurvey&&item.start_succeeded){
      item.passive_timer_watch=[];
      for(let elapsed=0;elapsed<=90;elapsed+=3){
        if(elapsed)await sleep(3000);
        const state=await page.evaluate(inspect);
        item.passive_timer_watch.push({elapsed_seconds:elapsed,timers:state.timer_elements,radio_groups:state.radio_groups,controls:state.controls,visible_text:state.text});
        item.state=state;
      }
      item.passive_timer_watch_input_sent=false;
      item.survey_terminal=await page.evaluate(`(()=>{const result=document.querySelector('.sd-completedpage,.sv-completedpage');const timer=document.querySelector('.sd-timer');const visible=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'};return {result_present:!!result,result_visible:visible(result),result_class:result?.className??null,result_text:visible(result)?result.innerText.slice(0,1200):null,timer_present:!!timer,timer_visible:visible(timer),body_class:document.querySelector('.sd-body')?.className??null,visible_question_inputs:[...document.querySelectorAll('.sd-body input')].filter(visible).length,visible_navigation:[...document.querySelectorAll('.sd-body button')].filter(visible).map(e=>({class:e.className,text:e.innerText.slice(0,100)}))};})()`);
    }
    if(!/^https?:/.test(item.state.url))throw new Error("Owned site navigation did not settle; inventory unverified");
    await page.send("Page.startScreencast",{format:"png",maxFramesInFlight:1});
    try{const image=await page.send("Page.captureScreenshot",{format:"png",fromSurface:true,captureBeyondViewport:false});
      item.screenshot=resolve(directory,`site-${index}.png`);await writeFile(item.screenshot,Buffer.from(image.data,"base64"));
    }finally{await page.send("Page.stopScreencast").catch(()=>{});}
    if(!embedded&&!item.state.access_blocked){await Promise.all([...new Set(item.state.iframes)].filter(childUrl=>/h5p|\/embed\//i.test(childUrl)).slice(0,3).map((childUrl,i)=>audit(childUrl,`${index}-${i}`,true)));}
    const reviewedBookListings=new Set(['https://pressbooks.justwrite.in/interactive-biology-secondary/h5p-listing/','https://openbooks.lib.msu.edu/isb202/h5p-listing/']);
    if(catalogWalk&&!embedded&&!item.state.access_blocked&&reviewedBookListings.has(new URL(url).origin+new URL(url).pathname)){
      auditedCatalogPages.add(item.state.url);
      const current=Number(new URL(item.state.url).searchParams.get('hpage')??1);
      const nextPage=item.state.pagination_links?.find(link=>{const target=new URL(link.url);return target.origin===new URL(url).origin&&target.pathname===new URL(url).pathname&&Number(target.searchParams.get('hpage'))===current+1;})?.url;
      if(nextPage&&!auditedCatalogPages.has(nextPage)&&auditedCatalogPages.size<15){
        item.followed_next_catalog_page=nextPage;
        await browser.send('Target.closeTarget',{targetId:ownedTargetId});ownedTargetId=null;delete item.page;
        await audit(nextPage,`${index}-next`,false);
      }
    }
    const parsedCatalog=new URL(url);
    const catalogSupported=(parsedCatalog.hostname==='h5pstudio.ecampusontario.ca'&&/^\/(?:catalogue)?$/.test(parsedCatalog.pathname))||(parsedCatalog.hostname==='studio.libretexts.org'&&parsedCatalog.pathname==='/library'&&Array.isArray(item.state.catalog_question_set_links));
    if(catalogCandidates&&!embedded&&!item.state.access_blocked&&catalogSupported){
      auditedCatalogPages.add(item.state.url);
      const sourceLinks=parsedCatalog.hostname==='studio.libretexts.org'?item.state.catalog_question_set_links:item.state.related_links.map(link=>link.url);
      const candidates=[...new Set(sourceLinks)].filter(link=>/^https:\/\/(?:h5pstudio\.ecampusontario\.ca\/content|studio\.libretexts\.org\/h5p)\/\d+$/.test(link)).slice(0,20);
      item.followed_public_candidates=candidates;
      let next=0;
      await Promise.all(Array.from({length:2},async()=>{while(next<candidates.length){const slot=next++;await audit(candidates[slot],`${index}-candidate-${slot}`,false);}}));
      let nextPage;
      if(parsedCatalog.hostname==='studio.libretexts.org'){
        const currentUrl=new URL(item.state.url);
        const currentPage=Number(currentUrl.searchParams.get('page')??0);
        const nextLink=item.state.pagination_links?.find(link=>{
          const target=new URL(link.url);
          return target.origin===currentUrl.origin&&target.pathname===currentUrl.pathname&&Number(target.searchParams.get('page'))===currentPage+1;
        });
        if(nextLink){
          const target=new URL(nextLink.url);
          nextPage=target.href;
        }
      }else nextPage=item.state.pagination_links?.find(link=>/^Next\b/.test(link.text))?.url;
      if(catalogWalk&&nextPage&&!auditedCatalogPages.has(nextPage)&&auditedCatalogPages.size<15){
        item.followed_next_catalog_page=nextPage;
        await browser.send('Target.closeTarget',{targetId:ownedTargetId});ownedTargetId=null;delete item.page;
        await audit(nextPage,`${index}-next`,false);
      }
    }
  }catch(error){
    item.error=error.message;
    // Preserve what actually obstructed an optional public-entry probe.
    // This is observation only: never remove an overlay or force a click.
    if(item.page)try{
      item.state=await item.page.evaluate(inspect);
      item.obstructing_dialogs=await item.page.evaluate(`(()=>{const matches=[...document.querySelectorAll('[role=dialog],[class*=cookie],[id*=cookie]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'});return matches.slice(0,6).map(e=>({tag:e.tagName,class:e.className,text:e.innerText?.slice(0,1000)}));})()`);
      if(startSurvey)item.cookie_choice_markup=await item.page.evaluate(`document.querySelector('.v2-class---popup__cookies-settings-list')?.outerHTML.slice(0,5000)??null`);
      const png=await item.page.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});
      item.screenshot=resolve(directory,`site-${index}-error.png`);await writeFile(item.screenshot,Buffer.from(png.data,'base64'));
    }catch(diagnosticError){item.diagnostic_error=diagnosticError.message;}
  }
  finally{delete item.page;if(diagnosticListener)browser.socket.removeEventListener('message',diagnosticListener);if(ownedTargetId)await browser.send('Target.closeTarget',{targetId:ownedTargetId}).catch(()=>{});}
  console.log("SITE",JSON.stringify({url:item.url,error:item.error,blocked:item.state?.access_blocked,started:item.start_succeeded,inventories:item.state?.inventories,followed_candidates:item.followed_public_candidates?.length,screenshot:item.screenshot}));
}
try{
  for(let i=0;i<60;i++){try{const port=Number((await readFile(resolve(profile,"DevToolsActivePort"),"utf8")).split("\n")[0]);
    const version=await cdpJson(port,"/json/version");browser=new CdpClient(version.webSocketDebuggerUrl);break;}catch{await sleep(100)}}
  if(!browser)throw new Error("Owned audit browser did not start");
  console.log("REPORT_DIRECTORY",directory);
  await Promise.all(urls.map((url,index)=>audit(url,index)));
}catch(error){report.errors.push(error.message);process.exitCode=1;}
finally{
  if(browser){try{await browser.send("Browser.close")}catch{}browser.close();}else if(child.exitCode===null)child.kill();
  report.finished_at=new Date().toISOString();
  await writeFile(resolve(directory,"report.json"),JSON.stringify(report,null,2));
}
