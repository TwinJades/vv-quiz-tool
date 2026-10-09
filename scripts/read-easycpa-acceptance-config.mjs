import { readFile } from 'node:fs/promises';
import {parseDocument} from 'yaml';
import { assertAcceptanceProvider } from './authorized-test-model.mjs';

const endpoint = 'http://127.0.0.1:8317/v1';
const invalid = () => new Error('Unsupported EasyCPA acceptance configuration; no credentials were copied.');

export function parseEasyCpaAcceptanceConfig(text, models) {
  if (typeof text !== 'string' ||
      !Array.isArray(models) || !models.length ||
      models.some(id => typeof id !== 'string' || !/^gemini-3\.(?:8-flash|7-flash|1-pro)(?:-[\w.-]+)?$/.test(id))) throw invalid();
  const document=parseDocument(text,{strict:true,uniqueKeys:true,prettyErrors:false,logLevel:'silent'});
  if(document.errors.length||document.warnings.length)throw invalid();
  const config=document.toJS({maxAliasCount:0});
  if(config?.server?.port!==8317||config.server.tls?.enable!==false)throw invalid();
  const keys=config.access?.['api-keys'];
  if(!Array.isArray(keys)||keys.some(key=>typeof key!=='string'||!key.trim()||/[\r\n\x00-\x1f\x7f]/.test(key)))throw invalid();
  if (keys.length !== 1) throw invalid();
  const profile = {
    schema_version: '1.0', provider_profile_id: 'easycpa-acceptance',
    display_name: 'EasyCPA isolated acceptance', provider_type: 'openai_compatible',
    base_url: endpoint, secret_ref: 'easycpa-acceptance-secret',
    model_catalog: { source: 'manual', models: [...new Set(models)], refreshed_at: null },
    // The user explicitly authorized public question text and necessary images.
    capabilities: { image_input: true, structured_output: true, native_web_search: false },
    image_upload_authorized: true,
  };
  assertAcceptanceProvider(profile);
  return { profile, secretKey: `provider-secret:${profile.secret_ref}`, secret: keys[0] };
}

export async function readEasyCpaAcceptanceConfig(path, models) {
  let text;
  try { text = await readFile(path, 'utf8'); }
  catch { throw new Error('Existing EasyCPA configuration could not be read; acceptance stopped.'); }
  return parseEasyCpaAcceptanceConfig(text, models);
}
