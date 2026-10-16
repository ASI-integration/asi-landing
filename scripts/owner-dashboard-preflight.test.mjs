import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
const probe = fs.readFileSync(path.join(root, 'scripts/owner-dashboard-preflight.sh'), 'utf8');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
const labels = ['SSH_IDENTITY','CURRENT_SYMLINK','SHARED_ENV_FILE','SHARED_ENV_READABLE','SESSION_SECRET_PRESENT','OWNER_EMAILS_PRESENT','GITHUB_TOKEN_PRESENT','LANDING_SERVICE_ACTIVE'];
// Inert shell functions replace every external probe; no host/env file is accessed.
function run(failed) {
  const fake = [
    'id() { printf "project_ayfaar"; }',
    'test() { [[ "$label" != "' + failed + '" ]]; }',
    'grep() { [[ "$label" != "' + failed + '" ]]; }',
    'systemctl() { [[ "$label" != "' + failed + '" ]]; }',
  ].join('\n') + '\n';
  assert.equal((probe.match(/\/usr\/bin\/systemctl/g) || []).length, 1);
  return spawnSync(bash, ['--noprofile', '--norc', '-s'], {
    input: fake + probe.replace('/usr/bin/systemctl', 'systemctl'),
    encoding: 'utf8', timeout: 5000,
    env: { PATH: process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin' : '/usr/bin:/bin', SYSTEMROOT: process.env.SYSTEMROOT || '', WINDIR: process.env.WINDIR || '' },
  });
}
test('all eight original predicates remain and successful mock emits labels only', () => {
  const r = run('NONE'); assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split('\n'), labels.map(x => x + '=PASS'));
  for (const name of ['SESSION_SECRET', 'ASI_DEVELOPMENT_OWNER_EMAILS', 'GITHUB_TOKEN']) assert.ok(probe.includes('^' + name + '=.+'));
  assert.ok(probe.includes('set +x'));
});
for (const [index, label] of labels.entries()) test('first failure stops at ' + label, () => {
  const r = run(label); assert.equal(r.status, 1, r.stderr);
  assert.deepEqual(r.stdout.trim().split('\n'), [...labels.slice(0,index).map(x => x + '=PASS'), label + '=FAIL']);
  assert.equal(r.stderr, '');
});
test('workflow invokes reviewed probe and retains approval, scope, identity and concurrency gates', () => {
  const s = fs.readFileSync(path.join(root, '.github/workflows/deploy-owner-engine-progress.yml'), 'utf8');
  assert.ok(s.includes("'bash -s' < scripts/owner-dashboard-preflight.sh"));
  for (const guard of ['environment: production','group: deploy-main','owner-engine-release-scope.mjs','EXPECTED_PREVIOUS_SHA','EXPECTED_MAIN_SHA','DEPLOY_OWNER_UI_ONLY']) assert.ok(s.includes(guard));
  assert.match(s, /OWNER_PREFLIGHT=FAIL[\s\S]*?exit 1/);
  assert.ok(s.indexOf('OWNER_PREFLIGHT=FAIL') < s.indexOf('- name: Deploy exact artifact'));
});
