import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {PINS,SOURCES} from '../acceptance/strigunov-task17-manifest.mjs';
const read=p=>readFileSync(p,'utf8'),hash=b=>createHash('sha256').update(b).digest('hex');
const lab=read('scripts/acceptance/strigunov-task17-lab.mjs'),workflow=read('.github/workflows/strigunov-pg-lab-manual.yml');
test('all immutable dependencies match pinned physical bytes',()=>{for(const [p,h] of Object.entries(PINS))assert.equal(hash(p==='package.json'||p==='package-lock.json'?execFileSync('git',['show','HEAD:'+p],{maxBuffer:20000000}):readFileSync(p)),h,p);});
test('transitive scenario imports are all in manifest',()=>{for(const p of SOURCES.filter(p=>p.endsWith('.mjs')&&p.includes('/acceptance/'))){for(const m of read(p).matchAll(/(?:from\s*|import\()['"](\.\/[^'"]+)['"]/g)){const target=p.slice(0,p.lastIndexOf('/')+1)+m[1].slice(2);assert.ok(SOURCES.includes(target),target);}}});
test('manual workflow has read-only permission and hosted timeout',()=>{assert.match(workflow,/workflow_dispatch:/);assert.doesNotMatch(workflow,/^  (push|pull_request|schedule|workflow_call):/m);assert.match(workflow,/contents: read/);assert.doesNotMatch(workflow,/write|self-hosted/);assert.match(workflow,/runs-on: ubuntu-24.04/);assert.match(workflow,/timeout-minutes: 15/);assert.match(workflow,/if: always\(\)/);});
test('actual driver wires phases and excludes authority overlay',()=>{assert.match(lab,/for\(const p of ORDER\)\{stage=p;await admin.query/);assert.match(lab,/await bootstrapFence\(/);assert.match(lab,/await executeScenario\(/);assert.doesNotMatch(lab,/task12-overlay|task13-phase2|issue_session\(/);assert.match(lab,/cases.length!==30/);});
test('credentials not emitted by driver and cleanup scoped',()=>{assert.doesNotMatch(lab,/console\.log|docker\(\['logs'|docker\(\['prune'/);assert.match(lab,/randomBytes\(32\)/);assert.match(lab,/owned\(expected,observed\)/);assert.match(lab,/status='HOLD'/);});
test('tracked package pin equals committed source',()=>{for(const p of ['package.json','package-lock.json'])assert.equal(hash(execFileSync('git',['show','HEAD:'+p],{maxBuffer:20000000})),PINS[p],p);});

test('trusted SHA check precedes checkout of event SHA',()=>{assert.ok(workflow.indexOf('Trusted admission before any checkout')<workflow.indexOf('uses: actions/checkout@'));assert.match(workflow,/ref: \$\{\{ github.sha \}\}/);assert.ok(workflow.indexOf('$REVIEWED_SHA" == "$GITHUB_SHA')>0);});
test('TCP readiness and positive role separation are executable',()=>{assert.match(lab,/'pg_isready','-h','127.0.0.1'/);assert.match(lab,/a=await connect\('task12_login_a'\),b=await connect\('task12_login_b'\)/);assert.match(lab,/denied=e.code==='28P01'/);assert.match(lab,/relforcerowsecurity/);});

test('synthetic approval has no environment API or secrets',()=>{assert.doesNotMatch(workflow,/environment:|GH_TOKEN|secrets\./);assert.doesNotMatch(lab,/fetch\(|environmentGate/);assert.match(workflow,/GITHUB_ACTOR_ID/);});
