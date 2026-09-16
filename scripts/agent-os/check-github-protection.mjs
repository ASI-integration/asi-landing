#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, validateArtifact } from './contracts.mjs';

const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DESIRED_PATH = 'docs/agent-os/github-protection-desired.json';

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function loadDesiredProtection(repoRoot = DEFAULT_REPO_ROOT) {
  const desired = readJson(path.join(repoRoot, DESIRED_PATH));
  validateArtifact('github-protection-desired', desired, repoRoot);
  invariant(desired.closure.requiresLiveVerification === true, 'Desired state must require live verification');
  return desired;
}

function ghJson(args) {
  const result = spawnSync('gh', ['api', ...args], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    const stderr = (result.stderr || result.stdout || '').trim();
    const error = new Error(stderr || `gh api ${args.join(' ')} failed`);
    error.exitCode = result.status;
    error.stderr = stderr;
    throw error;
  }
  return JSON.parse(result.stdout);
}

function ghJsonOrNull(args, treatStatusesAsNull = []) {
  try {
    return ghJson(args);
  } catch (error) {
    const text = String(error.stderr || error.message || '');
    if (treatStatusesAsNull.some((code) => text.includes(`(HTTP ${code})`) || text.includes(`"status":"${code}"`))) {
      return null;
    }
    throw error;
  }
}

export function fetchLiveProtectionSnapshot(repository = 'ASI-integration/asi-landing') {
  const branchProtection = ghJsonOrNull(
    [`repos/${repository}/branches/main/protection`],
    [404],
  );

  const rulesets = ghJson([`repos/${repository}/rulesets`]).map((entry) => {
    const detail = ghJson([`repos/${repository}/rulesets/${entry.id}`]);
    return {
      id: entry.id,
      name: entry.name,
      enforcement: entry.enforcement,
      includeRefs: detail.conditions?.ref_name?.include ?? [],
      ruleTypes: (detail.rules ?? []).map((rule) => rule.type),
    };
  });

  const envList = ghJson([`repos/${repository}/environments`]).environments ?? [];
  const byName = new Map(envList.map((env) => [env.name.toLowerCase(), env]));

  function normalizeEnvironment(logicalName) {
    const env = byName.get(logicalName.toLowerCase());
    if (!env) {
      return {
        name: logicalName,
        canAdminsBypass: true,
        reviewers: [],
        deploymentBranches: [],
        missing: true,
      };
    }

    const reviewers = (env.protection_rules ?? [])
      .filter((rule) => rule.type === 'required_reviewers')
      .flatMap((rule) => (rule.reviewers ?? []).map((item) => item.reviewer?.login).filter(Boolean));

    let deploymentBranches = [];
    if (env.deployment_branch_policy?.custom_branch_policies) {
      const policies = ghJson([
        `repos/${repository}/environments/${encodeURIComponent(env.name)}/deployment-branch-policies`,
      ]);
      deploymentBranches = (policies.branch_policies ?? []).map((policy) => policy.name).filter(Boolean);
    } else if (env.deployment_branch_policy?.protected_branches) {
      deploymentBranches = ['<protected-branches>'];
    }

    return {
      name: env.name,
      canAdminsBypass: env.can_admins_bypass !== false,
      reviewers,
      deploymentBranches,
      missing: false,
    };
  }

  return {
    auditedAt: new Date().toISOString(),
    repository,
    branchProtection: branchProtection
      ? {
          enabled: true,
          requirePullRequest: Boolean(branchProtection.required_pull_request_reviews),
          requiredApprovingReviewCount:
            branchProtection.required_pull_request_reviews?.required_approving_review_count ?? 0,
          dismissStaleReviews: Boolean(branchProtection.required_pull_request_reviews?.dismiss_stale_reviews),
          requireCodeOwnerReviews: Boolean(
            branchProtection.required_pull_request_reviews?.require_code_owner_reviews,
          ),
          requiredStatusChecks: branchProtection.required_status_checks?.contexts
            ?? branchProtection.required_status_checks?.checks?.map((check) => check.context)
            ?? [],
          allowForcePushes: Boolean(branchProtection.allow_force_pushes?.enabled),
          allowDeletions: Boolean(branchProtection.allow_deletions?.enabled),
          enforceAdmins: Boolean(branchProtection.enforce_admins?.enabled),
        }
      : null,
    rulesets,
    environments: {
      staging: normalizeEnvironment('staging'),
      production: normalizeEnvironment('production'),
      'production-migration-approval': normalizeEnvironment('production-migration-approval'),
    },
  };
}

function hasActiveMainRuleset(snapshot, desired) {
  return (snapshot.rulesets ?? []).some((ruleset) => {
    if (ruleset.enforcement !== 'active') return false;
    const includesMain = (ruleset.includeRefs ?? []).some((ref) => ref === 'refs/heads/main' || ref === '~DEFAULT_BRANCH');
    if (!includesMain) return false;
    const types = new Set(ruleset.ruleTypes ?? []);
    return types.has('pull_request') && types.has('required_status_checks');
  });
}

function evaluateMainProtection(snapshot, desired) {
  const gaps = [];
  const classic = snapshot.branchProtection;
  const rulesetOk = hasActiveMainRuleset(snapshot, desired);

  if (!classic?.enabled && !rulesetOk) {
    gaps.push('AO-001: main has neither classic branch protection nor an active ruleset covering refs/heads/main');
    return { ok: false, gaps };
  }

  if (classic?.enabled) {
    if (!classic.requirePullRequest) gaps.push('AO-001: classic protection missing required pull request');
    if ((classic.requiredApprovingReviewCount ?? 0) < desired.mainProtection.requiredApprovingReviewCount) {
      gaps.push(`AO-001: need >= ${desired.mainProtection.requiredApprovingReviewCount} approving reviews`);
    }
    if (desired.mainProtection.requireCodeOwnerReviews && !classic.requireCodeOwnerReviews) {
      gaps.push('AO-001: require code owner reviews is off');
    }
    for (const check of desired.mainProtection.requiredStatusChecks) {
      if (!(classic.requiredStatusChecks ?? []).includes(check)) {
        gaps.push(`AO-001: required status check missing: ${check}`);
      }
    }
    if (classic.allowForcePushes) gaps.push('AO-001: force pushes are allowed on main');
    if (classic.allowDeletions) gaps.push('AO-001: deletions are allowed on main');
    if (desired.mainProtection.includeAdministrators && !classic.enforceAdmins) {
      gaps.push('AO-001: administrators can bypass branch protection');
    }
  } else if (rulesetOk) {
    // Ruleset path is accepted when active and includes PR + required checks.
    // Exact review count / check contexts are still verified via classic API when present.
    gaps.push('AO-001: active ruleset present; re-check required contexts in the ruleset UI match validate');
  }

  return { ok: gaps.length === 0, gaps };
}

function evaluateEnvironment(logicalName, live, desiredEnv) {
  const gaps = [];
  if (!live || live.missing) {
    gaps.push(`AO-002: environment ${logicalName} is missing`);
    return gaps;
  }
  if (live.canAdminsBypass !== false) {
    gaps.push(`AO-002: ${logicalName} allows admin bypass`);
  }
  for (const reviewer of desiredEnv.requiredReviewers) {
    if (!(live.reviewers ?? []).includes(reviewer)) {
      gaps.push(`AO-002: ${logicalName} missing required reviewer ${reviewer}`);
    }
  }
  for (const branch of desiredEnv.deploymentBranches) {
    if (!(live.deploymentBranches ?? []).includes(branch)) {
      gaps.push(`AO-002: ${logicalName} missing deployment branch policy for ${branch}`);
    }
  }
  return gaps;
}

export function evaluateProtectionSnapshot(snapshot, desired) {
  const gaps = [];
  const classification = { A: [], B: [], C: [] };

  const main = evaluateMainProtection(snapshot, desired);
  gaps.push(...main.gaps);

  for (const envDesired of desired.environments) {
    const live = snapshot.environments?.[envDesired.name];
    gaps.push(...evaluateEnvironment(envDesired.name, live, envDesired));
  }

  // Classification helpers for the report.
  if (snapshot.environments?.production?.reviewers?.includes('ASI-integration')
    && snapshot.environments?.production?.deploymentBranches?.includes('main')
    && snapshot.environments?.production?.canAdminsBypass === false) {
    classification.A.push('production environment already has required reviewer ASI-integration, main-only branch policy, and admin bypass disabled');
  }
  if (snapshot.environments?.['production-migration-approval']?.reviewers?.includes('ASI-integration')
    && snapshot.environments?.['production-migration-approval']?.deploymentBranches?.includes('main')) {
    classification.A.push('production-migration-approval already has required reviewer + main branch policy (admin bypass still may be true)');
  }
  if (!snapshot.branchProtection?.enabled) {
    classification.C.push('Enable enforced main protection (ruleset or classic) with PR + review + required check validate');
  }
  if ((snapshot.environments?.staging?.reviewers ?? []).length === 0) {
    classification.C.push('Configure staging required reviewers + main deployment branch policy + disable admin bypass');
  }
  if (snapshot.environments?.['production-migration-approval']?.canAdminsBypass !== false) {
    classification.C.push('Disable admin bypass on production-migration-approval');
  }
  classification.B.push('Repository desired-state contract, CODEOWNERS, offline auditor, and owner runbook');

  const ao001Gaps = gaps.filter((gap) => gap.startsWith('AO-001:'));
  const ao002Gaps = gaps.filter((gap) => gap.startsWith('AO-002:'));

  return {
    ok: gaps.length === 0,
    gaps,
    classification,
    closure: {
      ao001: ao001Gaps.length === 0 ? 'ready-for-test-pr-verification' : 'open',
      ao002: ao002Gaps.length === 0 ? 'ready-for-dispatch-verification' : 'open',
    },
  };
}

export function checkGithubProtection({
  repoRoot = DEFAULT_REPO_ROOT,
  mode = 'offline',
  snapshot = null,
} = {}) {
  const desired = loadDesiredProtection(repoRoot);
  invariant(['offline', 'live', 'fixture'].includes(mode), `Unsupported mode: ${mode}`);

  if (mode === 'offline') {
    const gapFixture = readJson(path.join(repoRoot, 'docs/agent-os/fixtures/github-protection-live-gap-fixture.json'));
    const readyFixture = readJson(path.join(repoRoot, 'docs/agent-os/fixtures/github-protection-live-ready-fixture.json'));
    const gapEval = evaluateProtectionSnapshot(gapFixture, desired);
    const readyEval = evaluateProtectionSnapshot(readyFixture, desired);
    invariant(gapEval.ok === false, 'Gap fixture must fail closed');
    invariant(readyEval.ok === true, 'Ready fixture must pass');
    invariant(desired.closure.ao001 === 'open', 'AO-001 must remain open until live owner settings + test PR');
    invariant(desired.closure.ao002 === 'open', 'AO-002 must remain open until live owner settings + verification');
    return {
      ok: true,
      mode,
      check: 'github-protection-offline',
      desiredSchemaVersion: desired.schemaVersion,
      gapGaps: gapEval.gaps.length,
      readyOk: readyEval.ok,
    };
  }

  const live = snapshot ?? fetchLiveProtectionSnapshot(desired.repository);
  const evaluation = evaluateProtectionSnapshot(live, desired);
  return {
    ok: evaluation.ok,
    mode,
    check: 'github-protection-live',
    auditedAt: live.auditedAt,
    gaps: evaluation.gaps,
    classification: evaluation.classification,
    closure: evaluation.closure,
    snapshotSummary: {
      branchProtectionEnabled: Boolean(live.branchProtection?.enabled),
      rulesets: (live.rulesets ?? []).map((ruleset) => `${ruleset.name}:${ruleset.enforcement}`),
      stagingReviewers: live.environments?.staging?.reviewers ?? [],
      productionReviewers: live.environments?.production?.reviewers ?? [],
      productionMigrationReviewers: live.environments?.['production-migration-approval']?.reviewers ?? [],
    },
  };
}

function parseArgs(argv) {
  const options = { mode: 'offline', fixture: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--mode') {
      options.mode = argv[index + 1];
      index += 1;
    } else if (token === '--fixture') {
      options.mode = 'fixture';
      options.fixture = argv[index + 1];
      index += 1;
    }
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    let snapshot = null;
    if (options.mode === 'fixture') {
      invariant(options.fixture, '--fixture path is required');
      snapshot = readJson(path.resolve(options.fixture));
      options.mode = 'live';
    }
    const result = checkGithubProtection({
      mode: options.mode === 'live' ? 'live' : 'offline',
      snapshot,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exit(1);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
    process.exit(1);
  }
}
