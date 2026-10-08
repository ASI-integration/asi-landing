import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isRelevantEvent, evaluateLaunch, renderReport, sameMeaning, MARKER,
} from '../strigunov-launch-controller.mjs';

const issue = { body: '- [ ] Lead\n- [ ] Private\n- [ ] Consent\n- [ ] Mobile\n- [ ] Receipt\n- [ ] Production\n- [ ] Copy' };
const mergedLead = { number: 417, merged_at: '2026-10-08T12:21:02Z', merge_commit_sha: 'bc250b2e', title: 'Privacy/CRM lead funnel' };
const openAnti = { number: 420, state: 'open', title: 'Strigunov anti-abuse rate limit', head: { ref: 'dc/strigunov-lead-antiabuse' }, updated_at: '2026-10-08T16:00:00Z' };
const mergedAnti = { ...openAnti, merged_at: '2026-10-08T18:00:00Z', state: 'closed' };

test('only relevant Strigunov events initiate handoff', () => {
  assert.equal(isRelevantEvent('issues', 'edited', { issue: { number: 416 } }), true);
  assert.equal(isRelevantEvent('issues', 'edited', { issue: { number: 415 } }), false);
  assert.equal(isRelevantEvent('issue_comment', 'created', { issue: { number: 416 } }), false);
  assert.equal(isRelevantEvent('pull_request', 'closed', { pull_request: { title: 'Strigunov leads', head: { ref: 'feature' } } }), true);
  assert.equal(isRelevantEvent('pull_request', 'closed', { pull_request: { title: 'Unrelated billing', head: { ref: 'feature' } } }), false);
  assert.equal(isRelevantEvent('workflow_dispatch', '', {}), true);
  assert.equal(isRelevantEvent('workflow_run', 'completed', { workflow_run: { name: 'PR Validation', pull_requests: [{ head: { ref: 'dc/strigunov-lead' } }] } }), true);
  assert.equal(isRelevantEvent('workflow_run', 'completed', { workflow_run: { name: 'PR Validation', pull_requests: [{ head: { ref: 'feature/payment' } }] } }), false);
});

test('unmerged leads are P0 and fail closed', () => {
  const result = evaluateLaunch({ issue, prs: [] });
  assert.equal(result.status, 'NOT READY');
  assert.match(result.phase, /P0/);
  assert.equal(result.unresolvedChecklistItems, 7);
});

test('merged lead triggers next P1 handoff, not release', () => {
  const result = evaluateLaunch({ issue, prs: [mergedLead, openAnti] });
  assert.match(result.next, /PR #420/);
  assert.equal(result.status, 'NOT READY');
  assert.match(result.lead, /bc250b2e/);
  assert.match(renderReport(result), /NOT READY/);
});

test('merged antiabuse advances to isolated CRM acceptance only', () => {
  const result = evaluateLaunch({ issue, prs: [mergedLead, mergedAnti] });
  assert.match(result.next, /staging\/test CRM/);
  assert.equal(result.status, 'NOT READY');
});

test('even all checked issue gates never assert READY', () => {
  const checked = { body: issue.body.replaceAll('[ ]', '[x]') };
  const result = evaluateLaunch({ issue: checked, prs: [mergedLead, mergedAnti] });
  assert.equal(result.status, 'NOT READY');
  assert.equal(result.unresolvedChecklistItems, 0);
  assert.match(renderReport(result), /owner approval/);
});

test('stable output allows idempotent no-duplicate updates', () => {
  const body = renderReport(evaluateLaunch({ issue, prs: [mergedLead] }));
  assert.ok(body.startsWith(MARKER));
  assert.ok(sameMeaning(body, body));
  assert.equal(sameMeaning(body, body + 'changed'), false);
});

test('CI completion with matching head branch triggers handoff', () => {
  assert.equal(isRelevantEvent('workflow_run', 'completed', {
    workflow_run: { name: 'PR Validation', head_branch: 'dc/strigunov-security', pull_requests: [] },
  }), true);
});

test('issue milestones advance handoff tasks, still never mark ready', () => {
  const gates = [
    '- [ ] Lead', '- [ ] Private', '- [x] Consent', '- [x] Mobile',
    '- [x] Receipt', '- [ ] Production', '- [ ] Copy',
  ];
  const result = evaluateLaunch({
    issue: { body: gates.join('\n') },
    prs: [mergedLead, mergedAnti],
  });
  assert.equal(result.status, 'NOT READY');
  assert.match(result.phase, /Owner-gated/);
  assert.match(result.next, /owner approval/);
});