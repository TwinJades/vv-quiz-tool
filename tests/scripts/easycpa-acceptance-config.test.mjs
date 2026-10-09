import { describe, it, expect } from 'vitest';
import { parseEasyCpaAcceptanceConfig } from '../../scripts/read-easycpa-acceptance-config.mjs';

const models = ['gemini-3.8-flash-high', 'gemini-3.7-flash-high', 'gemini-3.1-pro-low'];
const sample = `api-keys:
    codex:
        - "api-key": "upstream-fixture-secret"
access:
    api-keys:
        - "local-fixture-secret"
server:
    host: ""
    port: 8317
    tls:
        enable: false
        cert: ""
        key: ""
management:
    secret-key: "management-fixture-secret"
`;
describe('independent EasyCPA acceptance configuration', () => {
  it('reads only the local client key and preserves the authorized model ids', () => {
    const configuration = parseEasyCpaAcceptanceConfig(sample, models);
    expect(configuration.secret).toBe('local-fixture-secret');
    expect(configuration.profile.base_url).toBe('http://127.0.0.1:8317/v1');
    expect(configuration.profile.model_catalog.models).toEqual(models);
    expect(configuration.secretKey).toBe('provider-secret:easycpa-acceptance-secret');
    expect(configuration.profile).toMatchObject({ image_upload_authorized: true,
      capabilities: { native_web_search: false, image_input: true } });
    expect(JSON.stringify(configuration.profile)).not.toContain('fixture-secret');
  });
  it('accepts CRLF, BOM and comments without using upstream or management keys', () => {
    const text = '\uFEFF' + sample.replace('    api-keys:\n        - "local', '    api-keys:\n# generated comment at column zero\n        # client only\n        - "local').replace('    tls:', '# generated TLS comment\n    tls:').replaceAll('\n', '\r\n');
    expect(parseEasyCpaAcceptanceConfig(text, models).secret).toBe('local-fixture-secret');
  });
  it('fails closed for missing or ambiguous client keys and unsupported YAML', () => {
    for (const text of [sample.replace('access:', 'other:'), sample + 'access:\n    api-keys:\n        - "other-secret"\n',
      sample.replace('        - "local-fixture-secret"', '        - "one"\n        - "two"'),
      sample.replace('        - "local-fixture-secret"', '        - ""'),
      sample.replace('        - "local-fixture-secret"', '        - "bad\\nsecret"')]) {
      expect(() => parseEasyCpaAcceptanceConfig(text, models)).toThrow('Unsupported EasyCPA');
    }
  });
  it('supports generated single-quoted client strings without treating YAML escapes as code', () => {
    const text = sample.replace('"local-fixture-secret"', "'local-fixture-secret''suffix'");
    expect(parseEasyCpaAcceptanceConfig(text, models).secret).toBe("local-fixture-secret'suffix");
  });
  it('accepts valid YAML indentation and plain client strings',()=>{
    expect(parseEasyCpaAcceptanceConfig(sample.replace('"local-fixture-secret"','local-fixture-secret').replaceAll('    ','  '),models).secret).toBe('local-fixture-secret');
  });
  it('rejects another port, TLS, duplicate port and unapproved model ids with redacted errors', () => {
    for (const [text, ids] of [[sample.replace('8317', '18080'), models],
      [sample.replace('enable: false', 'enable: true'), models],
      [sample.replace('port: 8317', 'port: 8317\n    port: 8317'), models],
      [sample, ['unapproved-fixture-model']], [sample, undefined]]) {
      try { parseEasyCpaAcceptanceConfig(text, ids); throw new Error('parser did not reject'); }
      catch (error) {
        expect(error.message).toContain('Unsupported EasyCPA');
        for (const value of ['fixture-secret', '18080', 'unapproved-fixture-model']) expect(error.message).not.toContain(value);
      }
    }
  });
});
