import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { visibleProviders } from '../src/config/llmProviders';

describe('providers on static hosting', () => {
  it('hides the server proxy when /api/llm/status did not answer', () => {
    expect(visibleProviders({ inApp: false, proxyFound: false, current: 'openrouter' })).not.toContain('proxy');
    expect(visibleProviders({ inApp: false, proxyFound: true, current: 'openrouter' })).toContain('proxy');
  });

  it('keeps a saved proxy choice visible so the dialog can explain it', () => {
    expect(visibleProviders({ inApp: false, proxyFound: false, current: 'proxy' })).toContain('proxy');
  });

  it('offers the on-device model only in the iOS app, and never the proxy there', () => {
    expect(visibleProviders({ inApp: true, proxyFound: true, current: 'proxy' })).toEqual(expect.arrayContaining(['device']));
    expect(visibleProviders({ inApp: true, proxyFound: true, current: 'proxy' })).not.toContain('proxy');
    expect(visibleProviders({ inApp: false, proxyFound: false, current: 'openrouter' })).not.toContain('device');
  });
});

describe('pre-deploy guard (scripts/check-deploy.mjs)', () => {
  const script = resolve(__dirname, '../scripts/check-deploy.mjs');
  const fakeKey = 'sk-test-0123456789abcdef';
  let dir = '';

  const project = (id: string) => {
    dir = mkdtempSync(join(tmpdir(), 'ironcore-deploy-'));
    writeFileSync(join(dir, '.firebaserc'), JSON.stringify({ projects: { default: id } }));
    writeFileSync(join(dir, '.env.local'), `LLM_PROXY_TARGET=http://127.0.0.1:8000/v1\nLLM_API_KEY=${fakeKey}\n`);
    mkdirSync(join(dir, 'dist/assets'), { recursive: true });
    writeFileSync(join(dir, 'dist/index.html'), '<!doctype html><script src="/assets/index.js"></script>');
    writeFileSync(join(dir, 'dist/assets/index.js'), 'const baseUrl = "http://127.0.0.1:8000/v1";');
  };
  const run = () => spawnSync(process.execPath, [script], { cwd: dir, env: { PATH: process.env.PATH }, encoding: 'utf8' });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('passes a clean build; a non-secret value such as the base URL may appear in it', () => {
    project('iron-core-test');
    const r = run();
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('stops on a key from .env.local in the bundle and does not print the key', () => {
    project('iron-core-test');
    writeFileSync(join(dir, 'dist/assets/index.js'), `const k = "${fakeKey}";`);
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('LLM_API_KEY');
    expect(r.stderr + r.stdout).not.toContain(fakeKey);
  });

  it('stops on an .env file in the build', () => {
    project('iron-core-test');
    writeFileSync(join(dir, 'dist/.env.local'), 'X=1\n');
    expect(run().status).toBe(1);
  });

  it('stops while .firebaserc still has the placeholder project id', () => {
    project('YOUR_FIREBASE_PROJECT_ID');
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('.firebaserc');
  });
});
