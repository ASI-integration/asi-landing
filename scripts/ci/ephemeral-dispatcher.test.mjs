import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  GOLD_BYTES, assessHost, classifyRuntime, planTick, recover, runsFromGh, selectJob,
} from './ephemeral-dispatcher.mjs';

const gold = {symlink:false, uid:0, mode:'0444', virtualBytes:GOLD_BYTES};
const host = (over = {}) => ({paidCalls:'NO', capKopecks:0, runners:[], gold, memAvailableKb:8 * 1024 * 1024, qemuAlive:false, ...over});
const run = (over = {}) => ({id:10, name:'PR Validation', event:'pull_request', fork:false, jobs:[{id:3, name:'source_validation', status:'queued'}], ...over});

test('only allowed same-repo CI jobs are selected, one at a time', () => {
  const runs = [
    run({id:11, name:'Deploy to VPS'}),
    run({id:9, name:'AI Reviewer Gate', event:'pull_request_target'}),
    run({id:8, event:'pull_request', fork:true}),
    run({id:12, name:'Agent Intake Triage', event:'workflow_dispatch', jobs:[{id:4, name:'triage', status:'queued'}]}),
    run({id:7, jobs:[{id:2, name:'source_validation', status:'queued'}, {id:5, name:'validate', status:'completed', conclusion:'failure'}]}),
    run(),
  ];
  const selected = selectJob(runs);
  assert.equal(selected.boot, true);
  assert.equal(selected.job.jobId, 2);
  assert.equal(selected.waiting, 3);
  const busy = {active:null};
  const first = planTick(host({slot:busy}), runs);
  busy.activeJobId = first.job.jobId;
  const second = planTick(host({slot:busy, activeJobId:first.job.jobId}), runs);
  assert.equal(first.job.jobId, 2);
  assert.equal(second.action, 'wait');
  assert.equal(second.boot, false);
});

test('host seal, memory, persistent runners, cap and paid mode block a boot', () => {
  assert.equal(assessHost(host({paidCalls:'YES'})).reason, 'PAID_CALLS_BLOCK');
  assert.equal(assessHost(host({capKopecks:1})).reason, 'CAP_BLOCK');
  assert.equal(assessHost(host({runners:[{online:true, ephemeral:false, labels:['asi-vps-onecom']}]} )).reason, 'PERSISTENT_RUNNER_BLOCK');
  assert.equal(assessHost(host({gold:{...gold, symlink:true}})).reason, 'GOLD_SEAL_BLOCK');
  assert.equal(assessHost(host({gold:{...gold, mode:'0644'}})).reason, 'GOLD_SEAL_BLOCK');
  assert.equal(assessHost(host({memAvailableKb:1024})).reason, 'WAIT_MEMORY');
  assert.equal(assessHost(host({qemuAlive:true})).reason, 'SLOT_BUSY');
  assert.equal(assessHost(host({lockAgeMs:71 * 60 * 1000})).reason, 'STALE_LOCK');
  assert.equal(planTick(host({paidCalls:'YES'}), [run()]).boot, false);
});

test('hangs stop the guest and a failed job is not retried', () => {
  assert.equal(classifyRuntime({conclusion:'success', qemuAlive:true}).reason, 'JOB_FINISHED');
  assert.equal(classifyRuntime({jobStatus:'queued', registeredAgoMs:4 * 60 * 1000}).reason, 'REGISTRATION_HANG');
  assert.equal(classifyRuntime({seedDetached:false, qemuAgeMs:5 * 60 * 1000}).signal, 'QMP_ONCE');
  assert.equal(classifyRuntime({seedDetached:false, qemuAgeMs:5 * 60 * 1000, qmpRetried:true}).signal, 'TERM');
  const hung = classifyRuntime({seedDetached:true, qemuAgeMs:3300 * 1000});
  assert.equal(hung.reason, 'GUEST_JOB_HANG');
  assert.equal(hung.retry, false);
  assert.equal(hung.killAfterSec, 30);
  assert.equal(classifyRuntime({conclusion:'failure'}).reason, 'NO_RETRY');
});

test('reboot recovery deletes overlays only and never rebuilds gold', () => {
  const result = recover({
    goldPath:'/var/cache/asi-landing-kvm/gold/image.qcow2',
    workDir:'/var/tmp/asi-ephemeral',
    qemuPids:[1, 4242, -5],
    files:[
      '/var/cache/asi-landing-kvm/gold/image.qcow2',
      '/var/tmp/asi-ephemeral/guest-1/disk.qcow2',
      '/var/tmp/asi-ephemeral/guest-1/seed.iso',
      '/etc/asi/ephemeral-dispatcher.env',
    ],
  });
  assert.deepEqual(result.kill, [4242]);
  assert.deepEqual(result.remove, [
    '/var/tmp/asi-ephemeral/guest-1/disk.qcow2',
    '/var/tmp/asi-ephemeral/guest-1/seed.iso',
  ]);
  assert.equal(result.keep.includes('/var/cache/asi-landing-kvm/gold/image.qcow2'), true);
  assert.equal(result.rebuildGold, false);
  assert.equal(recover({goldPath:'relative', workDir:'/tmp/x', files:[]}).reason, 'RECOVERY_PATHS');
});

test('github queue normalization keeps same-repo pull requests and drops other workflows', () => {
  const runs = runsFromGh({
    workflow_runs: [
      {id:4, name:'PR Validation', event:'pull_request', head_repository:{full_name:'ASI-integration/asi-landing'}},
      {id:5, name:'PR Validation', event:'pull_request', head_repository:{full_name:'other/asi-landing'}},
    ],
    jobsByRunId: {
      '4': {jobs:[{id:8, name:'source_validation', status:'queued', conclusion:null}]},
      '5': {jobs:[{id:9, name:'source_validation', status:'queued', conclusion:null}]},
    },
  });
  const selected = selectJob(runs);
  assert.equal(selected.job.jobId, 8);
  assert.equal(runsFromGh({workflow_runs:[]}), null);
});

test('package contains a gated unit, rollback, and no gold rebuild or paid client', () => {
  const root = new URL('./', import.meta.url);
  const read = name => readFileSync(new URL(name, root), 'utf8');
  const unit = read('asi-ephemeral-dispatcher.service');
  const install = read('install-ephemeral-dispatcher.sh');
  const dispatcher = read('asi-ephemeral-dispatcher.sh');
  assert.match(unit, /Restart=always/);
  assert.match(unit, /ExecStartPre=.* recover/);
  assert.match(unit, /ASI_DISPATCHER_EXECUTE=NO/);
  assert.match(install, /--rollback/);
  assert.match(install, /ASI_DISPATCHER_HOST_INSTALL=YES/);
  assert.doesNotMatch(install, /systemctl enable|systemctl start/);
  const joined = `${unit}\n${install}\n${dispatcher}`;
  assert.equal(joined.includes('foundation-models'), false);
  assert.equal(joined.includes('api.cloud.ru'), false);
  assert.equal(joined.includes('qemu-img convert'), false);
  assert.equal(dispatcher.includes('cloud-images.ubuntu.com'), false);
  assert.match(dispatcher, /timeout --signal=TERM --kill-after=/);
  assert.match(dispatcher, /3300/);
  const dir = fileURLToPath(root).replace(/\\/g, '/').replace(/\/$/, '');
  const gitBash = 'C:/Program Files/Git/bin/bash.exe';
  const bashBin = existsSync(gitBash) ? gitBash : 'bash';
  const syntax = spawnSync(bashBin, ['-n', `${dir}/asi-ephemeral-dispatcher.sh`], {encoding:'utf8'});
  if (syntax.error?.code === 'ENOENT') return;
  assert.equal(syntax.status, 0, syntax.stderr);
  const installSyntax = spawnSync(bashBin, ['-n', `${dir}/install-ephemeral-dispatcher.sh`], {encoding:'utf8'});
  assert.equal(installSyntax.status, 0, installSyntax.stderr);
  const tree = mkdtempSync(join(tmpdir(), 'asi-dispatcher-'));
  const bashTree = tree.replace(/\\/g, '/');
  try {
    if (process.platform === 'win32') {
      const proofScript = `
set -euo pipefail
mkdir -p /mnt/hostc
mountpoint -q /mnt/hostc || mount -t drvfs -o ro C: /mnt/hostc
SRC=/mnt/hostc/ASI/worktrees/landing/pr-687-standing-gate/scripts/ci
NODE=/root/node20/bin/node
test -x "$NODE"
ROOT=$(mktemp -d)
mkdir -p "$ROOT/etc/systemd/system"
printf 'OLD\\n' > "$ROOT/etc/systemd/system/asi-ephemeral-dispatcher.service"
printf keep > "$ROOT/old-marker"
bash "$SRC/install-ephemeral-dispatcher.sh" --apply "$ROOT"
grep -q ASI_DISPATCHER_EXECUTE=NO "$ROOT/etc/systemd/system/asi-ephemeral-dispatcher.service"
bash "$SRC/install-ephemeral-dispatcher.sh" --rollback "$ROOT/.asi-dispatcher-snapshot" "$ROOT"
test "$(cat "$ROOT/etc/systemd/system/asi-ephemeral-dispatcher.service")" = OLD
test "$(cat "$ROOT/old-marker")" = keep
Q=$(mktemp)
H=$(mktemp)
OUT=$(mktemp)
printf '%s\\n' '#!/bin/sh' 'echo "$1" > "$OUT"' > "$H"
chmod 0755 "$H"
printf '%s\\n' '{"host":{"paidCalls":"NO","capKopecks":0,"runners":[],"gold":{"symlink":false,"uid":0,"mode":"0444","virtualBytes":42949672960},"memAvailableKb":8388608,"qemuAlive":false},"runs":[{"id":1,"name":"PR Validation","event":"pull_request","fork":false,"jobs":[{"id":9,"name":"source_validation","status":"queued","conclusion":null}]}]}' > "$Q"
ASI_DISPATCHER_EXECUTE=YES ASI_GOLD_RUN_ONE="$H" ASI_QUEUE_FILE="$Q" ASI_NODE="$NODE" OUT="$OUT" bash "$SRC/asi-ephemeral-dispatcher.sh" serve
test "$(cat "$OUT")" = 9
rm -rf "$ROOT" "$Q" "$H" "$OUT"
`;
      const proof = spawnSync('wsl.exe', ['-d', 'ASI-Strigunov4-Restore', '-u', 'root', '--', 'bash', '-s'], {
        input: proofScript.replace(/^\n/, '').replace(/\r/g, ''),
        encoding: 'utf8',
      });
      assert.equal(proof.status, 0, `${proof.stdout || ''}${proof.stderr || ''}`);
      return;
    }
    const unitPath = join(tree, 'etc/systemd/system');
    mkdirSync(unitPath, {recursive:true});
    writeFileSync(join(unitPath, 'asi-ephemeral-dispatcher.service'), 'OLD\n');
    writeFileSync(join(tree, 'old-marker'), 'keep');
    const staged = spawnSync(bashBin, [`${dir}/install-ephemeral-dispatcher.sh`, '--apply', bashTree], {encoding:'utf8'});
    assert.equal(staged.status, 0, staged.stderr);
    assert.match(readFileSync(join(unitPath, 'asi-ephemeral-dispatcher.service'), 'utf8'), /ASI_DISPATCHER_EXECUTE=NO/);
    const rolled = spawnSync(bashBin, [`${dir}/install-ephemeral-dispatcher.sh`, '--rollback', `${bashTree}/.asi-dispatcher-snapshot`, bashTree], {encoding:'utf8'});
    assert.equal(rolled.status, 0, rolled.stderr);
    assert.equal(readFileSync(join(unitPath, 'asi-ephemeral-dispatcher.service'), 'utf8'), 'OLD\n');
    assert.equal(readFileSync(join(tree, 'old-marker'), 'utf8'), 'keep');
    const helper = `${bashTree}/helper.sh`;
    const queue = `${bashTree}/queue.json`;
    const out = `${bashTree}/out.txt`;
    writeFileSync(helper, '#!/bin/sh\necho "$1" > "$OUT"\n');
    writeFileSync(queue, JSON.stringify({
      host: {paidCalls:'NO', capKopecks:0, runners:[], gold, memAvailableKb:8 * 1024 * 1024, qemuAlive:false},
      runs: [run({id:1, jobs:[{id:9, name:'source_validation', status:'queued', conclusion:null}]})],
    }));
    const mode = spawnSync(bashBin, ['-c', `chmod 0755 ${JSON.stringify(helper)}`], {encoding:'utf8'});
    assert.equal(mode.status, 0, mode.stderr);
    const served = spawnSync(bashBin, [`${dir}/asi-ephemeral-dispatcher.sh`, 'serve'], {
      encoding:'utf8',
      env:{...process.env, ASI_DISPATCHER_EXECUTE:'YES', ASI_GOLD_RUN_ONE:helper, ASI_QUEUE_FILE:queue, ASI_NODE:process.execPath, OUT:out},
    });
    assert.equal(served.status, 0, `${served.stdout || ''}${served.stderr || ''}`);
    assert.equal(readFileSync(out, 'utf8').trim(), '9');
  } finally {
    rmSync(tree, {recursive:true, force:true});
  }
});
