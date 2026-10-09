declare const __VV_TEST_BUILD__:boolean;
declare global {var __vvTestDomTransitions:unknown[]|undefined;var __vvTestPixels:unknown[]|undefined;}
export function recordTestEvent(kind:string,value:unknown):void {
  if(typeof __VV_TEST_BUILD__==='undefined'||!__VV_TEST_BUILD__)return;
  if(kind.startsWith('dom-')){
    const entries=globalThis.__vvTestDomTransitions??=[];
    if(entries.length>=500)entries.shift();entries.push({at:Date.now(),...value as Record<string,unknown>});
  }else if(kind==='pixels'){
    const {data,...metadata}=value as {data:Uint8Array;[key:string]:unknown};
    let binary='';for(const byte of data)binary+=String.fromCharCode(byte);
    const entries=globalThis.__vvTestPixels??=[];if(entries.length>=80)entries.shift();entries.push({...metadata,index:entries.length,png:btoa(binary)});
  }else if(kind==='visual-reading'||kind==='notification'){
    const prefix=kind==='notification'?'vv-test-notice:':'vv-test-visual:';
    void chrome.storage.session.set({[prefix+crypto.randomUUID()]:value});
  }
}
