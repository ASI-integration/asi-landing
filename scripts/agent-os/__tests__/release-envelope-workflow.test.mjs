import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const workflow=readFileSync(new URL('../../../.github/workflows/pr-validation.yml',import.meta.url),'utf8');
const jobs=Object.fromEntries([...workflow.split('\njobs:\n')[1].matchAll(/^  ([a-z_-]+):\n([\s\S]*?)(?=^  [a-z_-]+:\n|$(?![\s\S]))/gm)]
  .map(m=>[m[1],m[2]]));

test('required validate remains aggregate admission, never a source-only green check',()=>{
  assert.deepEqual(Object.keys(jobs).sort(),['channel-manager-recovery-postgres','source_validation','validate']);
  assert.match(jobs.validate,/needs: \[source_validation, channel-manager-recovery-postgres\]/);
  assert.match(jobs.validate,/if: \$\{\{ !cancelled\(\) \}\}/);
  assert.match(jobs.validate,/SOURCE_RESULT: \$\{\{ needs.source_validation.result \}\}/);
  assert.match(jobs.validate,/RECOVERY_RESULT: \$\{\{ needs.channel-manager-recovery-postgres.result \}\}/);
  assert.equal((jobs.validate.match(/node scripts\/agent-os\/check-demo-release.mjs --ci/g)||[]).length,1);
  assert.doesNotMatch(jobs.source_validation,/check-demo-release.mjs --ci/);
  assert.doesNotMatch(jobs.validate,/continue-on-error|\|\| true/);
});

test('aggregate dependency guard rejects failure, cancellation, skipped and unknown results',()=>{
  const script=jobs.validate.match(/run: \|\n([\s\S]*?)(?=      - name: Checkout)/)[1]
    .split('\n').map(s=>s.replace(/^          /,'')).join('\n');
  for(const source of ['success','failure','cancelled','skipped','']){
    for(const recovery of ['success','failure','cancelled','skipped','']){
      const result=spawnSync('bash',['--noprofile','--norc','-eo','pipefail','-c',script],
        {env:{PATH:process.env.PATH,SOURCE_RESULT:source,RECOVERY_RESULT:recovery}});
      assert.equal(result.status===0,source==='success'&&recovery==='success',`${source}/${recovery}`);
    }
  }
});

test('admission keeps v0 token/command and full history without persisted credentials',()=>{
  assert.match(jobs.validate,/fetch-depth: 0\n          persist-credentials: false/);
  assert.match(jobs.validate,/GITHUB_TOKEN: \$\{\{ github.token \}\}/);
  assert.match(jobs.validate,/node scripts\/agent-os\/check-demo-release.mjs --ci/);
  assert.doesNotMatch(jobs.validate,/readAndAssessProtectedGateProposal|AUTHORIZED|skip[-_]gate/i);
});

test('trusted boundary executes protected base only and retains independent v0 admission',()=>{
  const trusted=readFileSync(new URL('../../../.github/workflows/asi-release-governance.yml',import.meta.url),'utf8');
  assert.match(trusted,/ref: \$\{\{ github.event.pull_request.base.sha \}\}/);
  assert.match(trusted,/run: node scripts\/agent-os\/check-demo-release.mjs --ci/);
  assert.doesNotMatch(trusted,/continue-on-error|readAndAssessProtectedGateProposal/);
});
