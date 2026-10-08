#!/usr/bin/env node
/** Event-driven Strigunov handoff. No merges, deployments or applicant data. */
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const TRACKING_ISSUE = 416;
export const MARKER = '<!-- ASI-STRIGUNOV-EVENT-CONTROLLER-V1 -->';

export function isRelevantEvent(name, action, payload = {}) {
  if (name === 'workflow_dispatch') return true;
  if (name === 'issues') {
    return payload.issue?.number === TRACKING_ISSUE &&
      ['edited', 'reopened', 'labeled', 'unlabeled'].includes(action);
  }
  if (name === 'pull_request') {
    return ['opened', 'synchronize', 'reopened', 'closed'].includes(action) &&
      /strigunov|early.access|lead.funnel|lead.antiabuse|mobile.ux/i.test(
        [payload.pull_request?.title, payload.pull_request?.head?.ref].join(' '),
      );
  }
  if (name === 'workflow_run') {
    const refs = [
      payload.workflow_run?.head_branch,
      ...(payload.workflow_run?.pull_requests ?? []).map((pr) => [pr.title, pr.head?.ref].join(' ')),
    ];
    return action === 'completed' && payload.workflow_run?.name === 'PR Validation' &&
      refs.some((ref) => /strigunov|early.access|lead.funnel|lead.antiabuse|mobile.ux/i.test(ref ?? ''));
  }
  return false;
}

export function evaluateLaunch({ issue, prs }) {
  const mergedLead = prs.find((pr) => pr.number === 417 && pr.merged_at);
  const antiAbuse = prs.filter((pr) =>
    /strigunov.*(anti.abuse|antiabuse|rate.limit|dedup)|(anti.abuse|antiabuse).*strigunov/i.test(
      [pr.title, pr.head?.ref].join(' '),
    ),
  ).sort((a, b) => new Date(b.updated_at ?? 0) - new Date(a.updated_at ?? 0));
  const antiMerged = antiAbuse.find((pr) => pr.merged_at);
  const antiOpen = antiAbuse.find((pr) => pr.state === 'open');
  const openChecks = (issue.body ?? '').match(/^- \[ \]/gm)?.length ?? 0;
  let next = 'Complete the privacy-safe CRM-backed public lead implementation.';
  let phase = 'P0 - lead/privacy implementation';
  if (mergedLead) {
    next = antiOpen
      ? 'Review anti-abuse PR #' + antiOpen.number + ' and its latest CI before merging.'
      : 'Finish rate limiting + retry deduplication; inspect active local Strigunov worktrees before starting an agent.';
    phase = 'P1 - application anti-abuse';
  }
  if (antiMerged) {
    phase = 'P1 - isolated CRM acceptance';
    next = 'Prove real staging/test CRM persistence, referral attribution and operator queue visibility without production submissions.';
    const gates = [...(issue.body ?? '').matchAll(/^- \[([ xX])\]/gm)]
      .map((match) => match[1].toLowerCase() === 'x');
    if (gates[4]) {
      phase = 'P1 - mobile, legal and links QA';
      next = 'Review actual mobile layout, privacy/consent, 14-day pilot wording, CTAs and no-payment behavior.';
    }
    if (gates[4] && gates[2] && gates[3]) {
      phase = 'Owner-gated production verification';
      next = 'Request specific owner approval for deployment. Afterward prove read-only page/version health and an owner-authorized live CRM receipt.';
    }
    if (gates.length >= 7 && gates.every(Boolean)) {
      phase = 'Independent launch review';
      next = 'Independently re-check all source evidence; only the owner can authorize publication.';
    }
  }
  // Never infer production receipt, privacy, or launch readiness from a PR or CI.
  return {
    status: 'NOT READY', phase, next,
    lead: mergedLead ? 'Merged PR #417 (' + (mergedLead.merge_commit_sha ?? 'SHA unavailable') + ')' : 'Unmerged/unverified',
    anti: antiMerged ? 'Merged PR #' + antiMerged.number :
      antiOpen ? 'Open PR #' + antiOpen.number : 'Not merged',
    unresolvedChecklistItems: openChecks,
    ownerGate: 'Production deployment, controlled live receipt verification and external publication require separate owner approval.',
  };
}

export function renderReport(result) {
  return [
    MARKER,
    '### ASI -> Strigunov: event-driven launch handoff',
    '',
    '**NOT READY** - development tracker only, not production readiness certification.',
    '',
    '- Current phase: **' + result.phase + '**',
    '- Lead/PII code: ' + result.lead,
    '- Anti-abuse code: ' + result.anti,
    '- Unchecked gates in issue #416: ' + result.unresolvedChecklistItems,
    '- **Next safe action:** ' + result.next,
    '',
    result.ownerGate,
    'No agents are launched automatically. CI alone never marks READY.',
    '',
    '<!-- END ASI-STRIGUNOV-EVENT-CONTROLLER-V1 -->',
  ].join('\n');
}

export function sameMeaning(a, b) {
  return a?.trim() === b?.trim();
}

async function run() {
  const eventName = process.env.GITHUB_EVENT_NAME ?? 'workflow_dispatch';
  const path = process.env.GITHUB_EVENT_PATH;
  const payload = path ? JSON.parse(await fs.readFile(path, 'utf8')) : {};
  if (!isRelevantEvent(eventName, payload.action ?? '', payload)) {
    console.log('SKIP: unrelated GitHub event');
    return;
  }
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repo ?? '')) throw new Error('GitHub token/repo required');
  const [owner, name] = repo.split('/');
  const api = async (suffix, method = 'GET', data) => {
    const response = await fetch('https://api.github.com' + suffix, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(data ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    if (!response.ok) throw new Error('GitHub API ' + response.status + ': ' + suffix);
    return response.json();
  };
  const base = '/repos/' + owner + '/' + name;
  const [issue, recentPrs, comments, leadPr] = await Promise.all([
    api(base + '/issues/' + TRACKING_ISSUE),
    api(base + '/pulls?state=all&sort=updated&direction=desc&per_page=100'),
    api(base + '/issues/' + TRACKING_ISSUE + '/comments?per_page=100'),
    api(base + '/pulls/417'),
  ]);
  if (issue.state !== 'open') {
    console.log('SKIP: tracking issue closed');
    return;
  }
  const prs = recentPrs.some((pr) => pr.number === 417) ? recentPrs : [leadPr, ...recentPrs];
  const report = renderReport(evaluateLaunch({ issue, prs }));
  const existing = [...comments].reverse().find((comment) =>
    typeof comment.body === 'string' && comment.body.startsWith(MARKER) &&
    comment.user?.login === 'github-actions[bot]');
  if (sameMeaning(existing?.body, report)) {
    console.log('NO CHANGE: no repeated notification');
  } else if (existing) {
    await api(base + '/issues/comments/' + existing.id, 'PATCH', { body: report });
    console.log('UPDATED: meaningful handoff change');
  } else {
    await api(base + '/issues/' + TRACKING_ISSUE + '/comments', 'POST', { body: report });
    console.log('CREATED: handoff comment');
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, report + '\n');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}