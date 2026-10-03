// Acceptance-only policy. It cannot change a user's Provider or its routing.
const tier=id=>/^gemini-3\.8-flash(?:-|$)/.test(id)?0:/^gemini-3\.7-flash(?:-|$)/.test(id)?1:/^gemini-3\.1-pro(?:-|$)/.test(id)?2:3;
export function authorizedTestModel({configured,available,requested,fallbackEvidence}) {
  const allowed=configured.filter(id=>tier(id)<3&&available.includes(id)).sort((a,b)=>tier(a)-tier(b));
  if(!allowed.length)throw new Error('No user-authorized configured Gemini model is currently listed by CPA');
  if(!requested)return {id:allowed[0],allowed,fallback:false};
  if(!allowed.includes(requested))throw new Error('Requested acceptance model is not authorized, configured and freshly listed');
  const fallback=tier(requested)>tier(allowed[0]);
  if(fallback){
    const evidence=fallbackEvidence;
    if(!evidence||tier(evidence.selected_model??'')>=tier(requested)||
      !evidence.results?.some(result=>result.snapshot?.state==='PAUSED'&&/Provider is temporarily unavailable\. HTTP 503\./.test(result.snapshot.notice??''))) {
      throw new Error('A lower-priority acceptance model needs a retained preferred-model HTTP503 failure report');
    }
  }
  return {id:requested,allowed,fallback};
}
