import {describe,it,expect} from 'vitest';
import {authorizedTestModel} from '../../scripts/authorized-test-model.mjs';
const configured=['gemini-3.1-pro-low','gemini-3.7-flash-high','gemini-3.8-flash-high','unapproved-model'];
const available=[...configured];
describe('real acceptance model authorization',()=>{
  it('prefers 3.8 regardless of configured order and falls back only to freshly listed allowed models',()=>{
    expect(authorizedTestModel({configured,available}).id).toBe('gemini-3.8-flash-high');
    expect(authorizedTestModel({configured,available:['gemini-3.7-flash-high']}).id).toBe('gemini-3.7-flash-high');
    expect(authorizedTestModel({configured,available:['gemini-3.1-pro-low']}).id).toBe('gemini-3.1-pro-low');
  });
  it('rejects unapproved, unconfigured and unlisted explicit requests',()=>{
    for(const requested of ['unapproved-model','gemini-3.8-flash-low','gemini-3.1-pro-missing'])expect(()=>authorizedTestModel({configured,available,requested})).toThrow('not authorized');
  });
  it('requires actual preferred-model service failure before overriding an available higher priority',()=>{
    const requested='gemini-3.7-flash-high';
    for(const fallbackEvidence of [undefined,{selected_model:'gemini-3.8-flash-high',results:[{snapshot:{state:'COMPLETE'}}]},
      {selected_model:'gemini-3.1-pro-low',results:[{snapshot:{state:'PAUSED',notice:'Provider is temporarily unavailable. HTTP 503.'}}]}])expect(()=>authorizedTestModel({configured,available,requested,fallbackEvidence})).toThrow('failure report');
    const fallbackEvidence={selected_model:'gemini-3.8-flash-high',results:[{snapshot:{state:'PAUSED',notice:'Provider is temporarily unavailable. HTTP 503.'}}]};
    expect(authorizedTestModel({configured,available,requested,fallbackEvidence})).toMatchObject({id:requested,fallback:true});
  });
});
