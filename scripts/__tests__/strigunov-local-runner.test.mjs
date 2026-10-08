import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseTask, taskKey, branchFor, instructionFor, MARKER, ISSUE, REPO,
} from '../strigunov-local-runner.mjs';

const issue = {
  state: 'open',
  body: '- [ ] End-to-end test of lead submission into CRM with a controlled nonproduction/test environment plus operator queue visibility.',
};
const bot = (phase, extra = '- Anti-abuse code: Merged PR #421') => [{
  user: { login: 'github-actions[bot]' },
  body: [
    MARKER,
    '### ASI -> Strigunov: event-driven launch handoff',
    '**NOT READY**',
    '- Current phase: **' + phase + '**',
    extra,
  ].join('\n'),
}];

test('tracker is fixed to the intended ASI launch issue and repository', () => {
  assert.equal(ISSUE, 416);
  assert.equal(REPO, 'ASI-integration/asi-landing');
});

test('unrelated phases and ordinary PR notifications do not start Codex', () => {
  assert.equal(chooseTask(issue, bot('P1 - application anti-abuse')), null);
  assert.equal(chooseTask(issue, bot('Owner-gated production verification')), null);
  assert.equal(chooseTask(issue, bot('P1 - mobile, legal and links QA')), null);
});

test('only exact bot-authored approved phase and merged anti-abuse trigger task', () => {
  assert.deepEqual(chooseTask(issue, bot('P1 - isolated CRM acceptance')), {
    id: 'crm-acceptance', antiPr: '421',
  });
  assert.equal(chooseTask(issue, bot('P1 - isolated CRM acceptance', '- Anti-abuse code: Open PR #421')), null);
  const malicious = bot('P1 - isolated CRM acceptance');
  malicious[0].user.login = 'unknown-contributor';
  assert.equal(chooseTask(issue, malicious), null);
});

test('closed issue or checked CRM acceptance cannot start task', () => {
  assert.equal(chooseTask({ ...issue, state: 'closed' }, bot('P1 - isolated CRM acceptance')), null);
  assert.equal(chooseTask({ state: 'open', body: '- [x] End-to-end test of lead submission' },
    bot('P1 - isolated CRM acceptance')), null);
});

test('missing marker or missing bot comment fail closed', () => {
  assert.equal(chooseTask(issue, []), null);
  const fake = bot('P1 - isolated CRM acceptance');
  fake[0].body = fake[0].body.replace(MARKER, '');
  assert.equal(chooseTask(issue, fake), null);
});

test('job key and branch contain only validated non-arbitrary text', () => {
  const t = chooseTask(issue, bot('P1 - isolated CRM acceptance'));
  const key = taskKey(t, 'a'.repeat(40));
  assert.match(key, /^crm-acceptance-/);
  assert.match(branchFor(key), /^dc\/strigunov-autojob-/);
  assert.throws(() => branchFor('evil/../main'));
  assert.equal(taskKey(t, 'bad'), null);
});

test('static instructions prohibit production or PR publication actions', () => {
  const prompt = instructionFor({ id: 'crm-acceptance' }, 'a'.repeat(40));
  assert.match(prompt, /No|DO NOT/i);
  assert.match(prompt, /production/);
  assert.match(prompt, /DO NOT.*push/);
  assert.match(prompt, /operator queue/);
  assert.throws(() => instructionFor({ id: 'arbitrary-task' }, 'a'.repeat(40)));
});
