import {describe, expect, it} from 'vitest';
import {verifiedG1Run} from '../proof';

const sha = 'a'.repeat(40);
const url = 'https://github.com/ASI-integration/asi-landing/actions/runs/123456';
const stage = {id: 'S4-G1', status: 'ACCEPTED', acceptanceSha: sha, proof: [url]};
const run = {repository: {full_name: 'ASI-integration/asi-landing'}, status: 'completed',
  conclusion: 'success', head_sha: sha, head_branch: 'main',
  path: '.github/workflows/strigunov4-c4-unit-apply.yml',
  event: 'workflow_dispatch', run_attempt: 1};
const approvals = [{user: {id: 207600140}, state: 'approved',
  environments: [{name: 'staging', can_admins_bypass: false}]}];
const jobs = {total_count: 1, jobs: [{name: 'protected_c4_unit_apply',
  status: 'completed', conclusion: 'success'}]};
describe('physical G1 proof', () => {
  it('accepts an exact owner-approved protected run', () => {
    expect(verifiedG1Run(stage, url, run, approvals, jobs)).toBe(true);
  });
  it('rejects ordinary successful CI', () => {
    expect(verifiedG1Run(stage, url, {...run, event: 'pull_request'}, approvals, jobs)).toBe(false);
  });
  it('rejects a run from the wrong host/workflow SHA binding', () => {
    expect(verifiedG1Run(stage, url, {...run, head_sha: 'b'.repeat(40)}, approvals, jobs)).toBe(false);
    expect(verifiedG1Run(stage, url, {...run, path: '.github/workflows/pr-validation.yml'}, approvals, jobs)).toBe(false);
  });
  it('rejects bypassable staging approval', () => {
    expect(verifiedG1Run(stage, url, run,
      [{...approvals[0], environments: [{name: 'staging', can_admins_bypass: true}]}], jobs)).toBe(false);
  });
  it('rejects absent or incomplete protected execution', () => {
    expect(verifiedG1Run(stage, url, run, approvals, {...jobs, total_count: 2})).toBe(false);
    expect(verifiedG1Run(stage, url, run, approvals, {...jobs, jobs: []})).toBe(false);
  });
  it('rejects unsigned and out-of-order stage claims', () => {
    expect(verifiedG1Run({...stage, proof: []}, url, run, approvals, jobs)).toBe(false);
    expect(verifiedG1Run({...stage, id: 'S4-G2'}, url, run, approvals, jobs)).toBe(false);
    expect(verifiedG1Run({...stage, status: 'IN_PROGRESS'}, url, run, approvals, jobs)).toBe(false);
  });
});
