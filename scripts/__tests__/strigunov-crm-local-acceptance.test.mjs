import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const runner = fileURLToPath(new URL('../strigunov-crm-local-acceptance.ts', import.meta.url));

function attempt(override = {}, args = []) {
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    ASI_LOCAL_CRM_ACCEPTANCE: '1',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'test-placeholder-not-a-real-key',
    ...override,
  };
  return spawnSync(process.execPath, ['--import', 'tsx', runner, ...args], {
    cwd: root, env, encoding: 'utf8', timeout: 15000, windowsHide: true,
  });
}

test('plan mode is read-only, needs no credentials', () => {
  const p = attempt({ NODE_ENV: 'production', SUPABASE_URL: 'https://invalid.example' }, ['--plan']);
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /Strigunov CRM local acceptance plan/);
});

test('requires explicit test mode', () => {
  const r = attempt({ NODE_ENV: 'development' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /NODE_ENV=test/);
});

test('requires explicit local fixture opt-in', () => {
  const r = attempt({ ASI_LOCAL_CRM_ACCEPTANCE: '0' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /ASI_LOCAL_CRM_ACCEPTANCE=1/);
});

test('refuses nonloopback Supabase URLs without writing data', () => {
  const r = attempt({ SUPABASE_URL: 'https://remote.example' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Refusing non-loopback/);
});

test('refuses localhost ports other than isolated fixture API', () => {
  const r = attempt({ SUPABASE_URL: 'http://127.0.0.1:1234' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /port 54321/);
});

test('refuses missing local service key before importing CRM repository', () => {
  const r = attempt({ SUPABASE_SERVICE_ROLE_KEY: '' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /SUPABASE_SERVICE_ROLE_KEY is required/);
});
