import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  GOLD_BYTES, assessHost, authorize, classifyRuntime, pollQueue, readSpendLedger, recover, selectJob,
} from './ephemeral-dispatcher.mjs';

const sha = 'a'.repeat(40);
const labels = ['self-hosted', 'linux', 'x64', 'asi-vps-onecom'];
const gold = {symlink:false, uid:0, mode:'0444', virtualBytes:GOLD_BYTES};
const job = (id, over = {}) => ({id, name:'source_validation', status:'queued', conclusion:null, labels, ...over});
const admitted = (over = {}) => ({
  id:10, name:'PR Validation', event:'pull_request', repository:'ASI-integration/asi-landing', fork:false,
  workflowFile:'.github/workflows/pr-validation.yml', workflowId:101, expectedWorkflowId:101,
  headSha:sha, exactHead:sha, admission:'owner-comment', jobs:[job(3)], ...over,
});

test('only an admitted queued job is selected', () => {
  const runs = [
    admitted({id:11, name:'Deploy to VPS', workflowFile:'.github/workflows/deploy.yml'}),
    admitted({id:9, name:'AI Reviewer Gate', event:'pull_request_target', admission:'owner-comment'}),
    admitted({id:8, fork:true, repository:'other/asi-landing'}),
    admitted({id:12, name:'Agent Intake Triage', event:'workflow_dispatch', admission:'default-branch', workflowFile:'.github/workflows/agent-intake-triage.yml', jobs:[job(4, {name:'triage'})]}),
    admitted({id:7, jobs:[job(2), job(5, {name:'validate', status:'completed', conclusion:'failure'})]}),
    admitted({id:6, admission:'missing'}),
    admitted(),
  ];
  const selected = selectJob(runs);
  assert.equal(selected.job.jobId, 2);
  assert.equal(selected.waiting, 3);
  assert.equal(selectJob(runs, null, [2, 4, 3]).reason, 'QUEUE_EMPTY');
  assert.equal(selectJob([admitted({headSha:'b'.repeat(40)})]).boot, false);
});

test('spend ledger is read from sqlite and json cap is ignored', () => {
  const dir = mkdtempSync(join(tmpdir(), 'asi-ledger-'));
  const ledger = join(dir, 'spend.sqlite3');
  writeFileSync(ledger, '');
  const spawn = (_cmd, _args) => ({status:0, stdout:'0 0 1\n'});
  assert.equal(readSpendLedger(ledger, spawn).reason, 'PAID_CALLS_BLOCK');
  const host = assessHost({
    ledgerPath:ledger, paidCalls:'NO', capKopecks:0,
    runners:{total_count:0, runners:[]}, gold, memAvailableKb:8 * 1024 * 1024,
  }, () => ({status:0, stdout:'0 0 1\n'}));
  assert.equal(host.reason, 'PAID_CALLS_BLOCK');
  const ignored = assessHost({
    ledgerPath:ledger, paidCalls:'YES', capKopecks:99,
    runners:{total_count:0, runners:[]}, gold, memAvailableKb:8 * 1024 * 1024,
  }, () => ({status:0, stdout:'0 0 0\n'}));
  assert.equal(ignored.reason, 'HOST_READY');
  rmSync(dir, {recursive:true, force:true});
});

test('read-only github poll checks repo, workflow, head, owner, labels and job id', () => {
  const pages = {
    'repos/ASI-integration/asi-landing': {full_name:'ASI-integration/asi-landing'},
    'repos/ASI-integration/asi-landing/actions/workflows/pr-validation.yml': {id:101, name:'PR Validation', path:'.github/workflows/pr-validation.yml'},
    'repos/ASI-integration/asi-landing/actions/workflows/agent-intake-triage.yml': {id:202, name:'Agent Intake Triage', path:'.github/workflows/agent-intake-triage.yml'},
    'repos/ASI-integration/asi-landing/actions/runs?status=queued&per_page=20': {workflow_runs:[{
      id:50, workflow_id:101, event:'pull_request', head_sha:sha,
      head_repository:{full_name:'ASI-integration/asi-landing'}, pull_requests:[{number:687}],
    }, {
      id:51, workflow_id:101, event:'pull_request', head_sha:sha,
      head_repository:{full_name:'ASI-integration/asi-landing'}, pull_requests:[{number:688}],
    }]},
    'repos/ASI-integration/asi-landing/actions/runners?per_page=100': {total_count:1, runners:[{ephemeral:false, labels:['self-hosted','linux','x64']}]},
    'repos/ASI-integration/asi-landing/commits/main': {sha:'b'.repeat(40)},
    'repos/ASI-integration/asi-landing/actions/runs/50/jobs?per_page=100': {jobs:[job(9)]},
    'repos/ASI-integration/asi-landing/actions/runs/51/jobs?per_page=100': {jobs:[job(11)]},
    'repos/ASI-integration/asi-landing/pulls/687': {head:{sha}},
    'repos/ASI-integration/asi-landing/pulls/688': {head:{sha}},
    'repos/ASI-integration/asi-landing/issues/687/comments?per_page=100&page=1': [{
      user:{id:207600140, type:'User'}, author_association:'OWNER', performed_via_github_app:null,
      body:`ASI-OWNER-APPROVE:CONTRACT-CHANGE:687:${sha}`,
    }],
    'repos/ASI-integration/asi-landing/issues/688/comments?per_page=100&page=1': [],
  };
  const calls = [];
  const polled = pollQueue({get(path) { calls.push(path); if (!(path in pages)) throw new Error(path); return pages[path]; }});
  const selected = selectJob(polled.runs);
  assert.equal(selected.job.jobId, 9);
  assert.equal(calls.some(path => path.includes('registration-token')), false);
  assert.equal(authorize(polled.runs && {
    repository:'ASI-integration/asi-landing', jobId:9, workflowId:101, headSha:sha,
    event:'pull_request', admission:'owner-comment', labels,
  }, 11).reason, 'UNAUTHORIZED_JOB');
  const blocked = pollQueue({get(path) {
    if (path.endsWith('/runners?per_page=100')) return {total_count:1, runners:[{ephemeral:false, labels}]};
    return pages[path];
  }});
  const ledgerDir = mkdtempSync(join(tmpdir(), 'asi-ledger-'));
  const ledger = join(ledgerDir, 'spend.sqlite3');
  writeFileSync(ledger, '');
  assert.equal(assessHost({
    ledgerPath:ledger, runners:blocked.runners, gold, memAvailableKb:8 * 1024 * 1024,
  }, () => ({status:0, stdout:'0 0 0\n'})).reason, 'PERSISTENT_RUNNER_BLOCK');
  rmSync(ledgerDir, {recursive:true, force:true});
});

test('hangs stop the guest and a failed job is not retried', () => {
  assert.equal(classifyRuntime({conclusion:'success', qemuAlive:true}).retry, false);
  assert.equal(classifyRuntime({seedDetached:true, qemuAgeMs:3300 * 1000}).reason, 'GUEST_JOB_HANG');
  assert.equal(classifyRuntime({timedOut:true}).reason, 'NO_RETRY');
  assert.equal(classifyRuntime({conclusion:'failure'}).retry, false);
});

test('reboot recovery keeps logs and never removes gold or a symlink target', () => {
  const result = recover({
    goldPath:'/var/cache/asi-landing-kvm/gold/image.qcow2',
    workDir:'/var/tmp/asi-ephemeral',
    qemuPids:[1, 4242],
    symlinks:['/var/tmp/asi-ephemeral/guest/evil.qcow2'],
    files:[
      '/var/cache/asi-landing-kvm/gold/image.qcow2',
      '/var/tmp/asi-ephemeral/guest/disk.qcow2',
      '/var/tmp/asi-ephemeral/guest/seed.iso',
      '/var/tmp/asi-ephemeral/guest/console.log',
      '/var/tmp/asi-ephemeral/guest/evil.qcow2',
    ],
  });
  assert.deepEqual(result.remove, [
    '/var/tmp/asi-ephemeral/guest/disk.qcow2',
    '/var/tmp/asi-ephemeral/guest/seed.iso',
  ]);
  assert.equal(result.keep.includes('/var/tmp/asi-ephemeral/guest/console.log'), true);
  assert.equal(result.keep.includes('/var/tmp/asi-ephemeral/guest/evil.qcow2'), true);
  assert.equal(result.rebuildGold, false);
});

test('installed dispatcher tree binds sbin to lib and rolls back a partial copy', () => {
  const source = readFileSync(new URL('./asi-ephemeral-dispatcher.service', import.meta.url), 'utf8');
  assert.equal(/^NoNewPrivileges=/m.test(source), false);
  assert.match(source, /sudo -n/);
  const dir = fileURLToPath(new URL('./prove-installed-dispatcher.sh', import.meta.url));
  if (process.platform === 'win32') {
    const script = `mkdir -p /mnt/hostc\nmountpoint -q /mnt/hostc || mount -t drvfs C: /mnt/hostc\nexport ASI_NODE=/root/node20/bin/node\nexport SRC=/mnt/hostc/ASI/worktrees/landing/pr-687-standing-gate/scripts/ci\nbash "$SRC/prove-installed-dispatcher.sh"\n`;
    const wrapped = spawnSync('wsl.exe', ['-d', 'ASI-Strigunov4-Restore', '-u', 'root', '--', 'bash', '-s'], {
      input:script, encoding:'utf8', timeout:120000,
    });
    assert.equal(wrapped.status, 0, `${wrapped.stdout || ''}${wrapped.stderr || ''}`);
    assert.match(`${wrapped.stdout || ''}`, /INSTALLED_DISPATCHER_PROVED/);
    return;
  }
  const proof = spawnSync('bash', [dir], {
    encoding:'utf8', timeout:120000,
    env:{...process.env, SRC:fileURLToPath(new URL('./', import.meta.url))},
  });
  assert.equal(proof.status, 0, `${proof.stdout || ''}${proof.stderr || ''}`);
  assert.match(proof.stdout || '', /INSTALLED_DISPATCHER_PROVED/);
});
