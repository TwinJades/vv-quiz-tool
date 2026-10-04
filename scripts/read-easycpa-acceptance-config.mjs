import { readFile } from 'node:fs/promises';
import { assertAcceptanceProvider } from './authorized-test-model.mjs';

const endpoint = 'http://127.0.0.1:8317/v1';
const invalid = () => new Error('Unsupported EasyCPA acceptance configuration; no credentials were copied.');

// Deliberately supports only the generated server/access shape, not arbitrary
// YAML. In particular, top-level api-keys contains upstream credentials and
// must never be mistaken for access.api-keys (local client authentication).
function block(lines, name) {
  const positions = lines.flatMap((line, i) => line === `${name}:` ? [i] : []);
  if (positions.length !== 1) throw invalid();
  const start = positions[0] + 1;
  let end = start;
  while (end < lines.length && (!/^\S/.test(lines[end]) || lines[end].startsWith('#'))) end++;
  return lines.slice(start, end).filter(line => line.trim() && !line.trim().startsWith('#'));
}

export function parseEasyCpaAcceptanceConfig(text, models) {
  if (typeof text !== 'string' || text.includes('\t') ||
      !Array.isArray(models) || !models.length ||
      models.some(id => typeof id !== 'string' || !/^gemini-3\.(?:8-flash|7-flash|1-pro)(?:-[\w.-]+)?$/.test(id))) throw invalid();
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trimEnd());
  const server = block(lines, 'server');
  const ports = server.filter(line => /^    port:/.test(line));
  const tls = server.filter(line => /^        enable:/.test(line));
  if (ports.length !== 1 || !/^    port: 8317$/.test(ports[0]) ||
      tls.length !== 1 || !/^        enable: false$/.test(tls[0])) throw invalid();
  const access = block(lines, 'access');
  if (access[0] !== '    api-keys:' || access.length < 2) throw invalid();
  const keys = access.slice(1).map(line => {
    const doubleQuoted = /^        - "(?:[^"\\]|\\.)*"$/.test(line);
    const singleQuoted = /^        - '(?:[^']|'')*'$/.test(line);
    if (!doubleQuoted && !singleQuoted) throw invalid();
    let key;
    const scalar = line.slice('        - '.length);
    try { key = doubleQuoted ? JSON.parse(scalar) : scalar.slice(1, -1).replaceAll("''", "'"); } catch { throw invalid(); }
    if (typeof key !== 'string' || !key.trim() || /[\r\n\x00-\x1f\x7f]/.test(key)) throw invalid();
    return key;
  });
  // Fail closed on ambiguous client accounts. Never try one key after another.
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
