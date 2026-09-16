#!/usr/bin/env node
/**
 * AO-006: machine-enforced agent-ready intake / Definition of Done.
 * Fail-closed: missing required fields or templates block READY status.
 * No network, no secrets, no environment mutation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const ISSUE_TEMPLATE_PATH = '.github/ISSUE_TEMPLATE/agent-ready-task.yml';
export const ISSUE_CONFIG_PATH = '.github/ISSUE_TEMPLATE/config.yml';
export const PR_TEMPLATE_PATH = '.github/PULL_REQUEST_TEMPLATE.md';

/** Required GitHub issue form field ids from the agent-ready template. */
export const REQUIRED_ISSUE_FIELD_IDS = [
  'objective',
  'context',
  'scope',
  'out_of_scope',
  'acceptance',
  'autonomy',
  'validation',
  'rollout',
  'owner_decisions',
];

/** Required markdown headings rendered into issue bodies from the form labels. */
export const REQUIRED_ISSUE_BODY_HEADINGS = [
  '### Цель',
  '### Контекст и источники истины',
  '### In scope',
  '### Out of scope',
  '### Acceptance criteria',
  '### Ожидаемый уровень автономности',
  '### Требуемая проверка',
  '### Staging, rollout и rollback',
  '### Решения Николая',
];

/** Required PR template sections that encode Definition of Done. */
export const REQUIRED_PR_SECTIONS = [
  '## Результат',
  '## Scope',
  '## Product contract',
  '## Autonomy и риск',
  '## Проверки',
  '## Data, migration и external side effects',
  '## Checklist',
];

/** Machine-readable task input fields required before autonomous work. */
export const REQUIRED_TASK_INPUT_KEYS = [
  'task.id',
  'task.title',
  'task.objective',
  'task.acceptanceCriteria',
  'task.inScope',
  'task.outOfScope',
  'classification',
];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function getByPath(value, dottedPath) {
  return dottedPath.split('.').reduce((current, key) => {
    if (current == null || typeof current !== 'object') return undefined;
    return current[key];
  }, value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonEmptyStringArray(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.every((entry) => isNonEmptyString(entry));
}

export function extractIssueFormFieldIds(yamlText) {
  const ids = [];
  for (const match of yamlText.matchAll(/^\s+id:\s*([A-Za-z0-9_-]+)\s*$/gm)) {
    ids.push(match[1]);
  }
  return ids;
}

export function assertIssueTemplateContract(repoRoot = DEFAULT_REPO_ROOT) {
  const absolute = path.join(repoRoot, ISSUE_TEMPLATE_PATH);
  invariant(fs.existsSync(absolute), `Missing issue template: ${ISSUE_TEMPLATE_PATH}`);
  const text = readText(absolute);
  invariant(text.includes('name: Agent-ready task'), 'Issue template must be named Agent-ready task');
  const ids = extractIssueFormFieldIds(text);
  const missing = REQUIRED_ISSUE_FIELD_IDS.filter((id) => !ids.includes(id));
  invariant(missing.length === 0, `Issue template missing required field ids: ${missing.join(', ')}`);
  for (const id of REQUIRED_ISSUE_FIELD_IDS) {
    const block = text.split(`id: ${id}`)[1]?.split(/^\s+id:\s+/m)[0] ?? '';
    invariant(
      /validations:\s*\n\s+required:\s*true/m.test(block),
      `Issue template field "${id}" must be required`,
    );
  }
  return { path: ISSUE_TEMPLATE_PATH, fieldIds: ids };
}

export function assertIssueTemplateDefaultFlow(repoRoot = DEFAULT_REPO_ROOT) {
  const absolute = path.join(repoRoot, ISSUE_CONFIG_PATH);
  invariant(fs.existsSync(absolute), `Missing issue template config: ${ISSUE_CONFIG_PATH}`);
  const text = readText(absolute);
  invariant(
    /^\s*blank_issues_enabled:\s*false\s*$/m.test(text),
    'blank_issues_enabled must be false so agent-ready intake is the default flow',
  );
  invariant(
    text.includes('template=agent-ready-task.yml'),
    'Issue config must link to agent-ready-task.yml',
  );
  return { path: ISSUE_CONFIG_PATH, blankIssuesEnabled: false };
}

export function assertPullRequestTemplateContract(repoRoot = DEFAULT_REPO_ROOT) {
  const absolute = path.join(repoRoot, PR_TEMPLATE_PATH);
  invariant(fs.existsSync(absolute), `Missing PR template: ${PR_TEMPLATE_PATH}`);
  const text = readText(absolute);
  const missing = REQUIRED_PR_SECTIONS.filter((heading) => !text.includes(heading));
  invariant(missing.length === 0, `PR template missing DoD sections: ${missing.join(', ')}`);
  invariant(text.includes('Baseline SHA'), 'PR template must require Baseline SHA');
  invariant(text.includes('Уровень:'), 'PR template must require autonomy level');
  return { path: PR_TEMPLATE_PATH, sections: REQUIRED_PR_SECTIONS };
}

export function validateTaskInput(input) {
  const blockers = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      status: 'BLOCKED',
      blockers: ['Task input must be a JSON object'],
    };
  }

  for (const key of REQUIRED_TASK_INPUT_KEYS) {
    const value = getByPath(input, key);
    if (key.endsWith('acceptanceCriteria') || key.endsWith('inScope') || key.endsWith('outOfScope')) {
      if (!isNonEmptyStringArray(value)) {
        blockers.push(`Missing or empty required field: ${key}`);
      }
      continue;
    }
    if (!isNonEmptyString(value) && !(key === 'classification' && ['green', 'yellow', 'red'].includes(value))) {
      blockers.push(`Missing or empty required field: ${key}`);
    }
  }

  if (!['green', 'yellow', 'red'].includes(input.classification)) {
    blockers.push('classification must be green, yellow, or red');
  }

  if (input.classification === 'red') {
    if (!Array.isArray(input.redActions) || input.redActions.length === 0) {
      blockers.push('red classification requires at least one redActions entry');
    }
  }

  if (Array.isArray(input.redActions) === false) {
    blockers.push('redActions must be an array (empty allowed for green/yellow)');
  }

  return {
    ok: blockers.length === 0,
    status: blockers.length === 0 ? 'READY' : 'BLOCKED',
    blockers: [...new Set(blockers)],
    classification: input.classification ?? null,
  };
}

function sectionBody(markdown, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escaped}[ \\t]*\\r?\\n([\\s\\S]*?)(?=\\r?\\n### |\\r?\\n## |$)`, 'm');
  const match = markdown.match(pattern);
  return match ? match[1].trim() : null;
}

export function validateIssueBody(markdown) {
  const blockers = [];
  if (!isNonEmptyString(markdown)) {
    return { ok: false, status: 'BLOCKED', blockers: ['Issue body is empty'] };
  }

  for (const heading of REQUIRED_ISSUE_BODY_HEADINGS) {
    if (!markdown.includes(heading)) {
      blockers.push(`Missing required section: ${heading}`);
      continue;
    }
    const body = sectionBody(markdown, heading);
    if (!isNonEmptyString(body) || body === '_No response_' || body === '<!-- -->') {
      blockers.push(`Empty required section: ${heading}`);
    }
  }

  return {
    ok: blockers.length === 0,
    status: blockers.length === 0 ? 'READY' : 'BLOCKED',
    blockers,
  };
}

export function validatePullRequestBody(markdown) {
  const blockers = [];
  if (!isNonEmptyString(markdown)) {
    return { ok: false, status: 'BLOCKED', blockers: ['Pull request body is empty'] };
  }

  for (const heading of REQUIRED_PR_SECTIONS) {
    if (!markdown.includes(heading)) {
      blockers.push(`Missing required DoD section: ${heading}`);
    }
  }

  if (!/Baseline SHA:\s*\S+/i.test(markdown)) {
    blockers.push('PR body must declare Baseline SHA');
  }
  if (!/Уровень:\s*`?(green|yellow|red)`?/i.test(markdown)) {
    blockers.push('PR body must declare autonomy level green/yellow/red');
  }

  return {
    ok: blockers.length === 0,
    status: blockers.length === 0 ? 'READY' : 'BLOCKED',
    blockers,
  };
}

export function checkRepositoryIntakeContracts(repoRoot = DEFAULT_REPO_ROOT) {
  return {
    ok: true,
    check: 'agent-intake',
    issueTemplate: assertIssueTemplateContract(repoRoot),
    issueConfig: assertIssueTemplateDefaultFlow(repoRoot),
    pullRequestTemplate: assertPullRequestTemplateContract(repoRoot),
  };
}

function parseArgs(argv) {
  const args = { mode: 'repo', file: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--issue-body') {
      args.mode = 'issue-body';
      args.file = argv[++index];
    } else if (value === '--pr-body') {
      args.mode = 'pr-body';
      args.file = argv[++index];
    } else if (value === '--task-input') {
      args.mode = 'task-input';
      args.file = argv[++index];
    } else if (value === '--repo') {
      args.mode = 'repo';
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    let result;
    if (args.mode === 'repo') {
      result = checkRepositoryIntakeContracts(DEFAULT_REPO_ROOT);
    } else if (args.mode === 'issue-body') {
      invariant(args.file, 'Missing path after --issue-body');
      result = validateIssueBody(readText(path.resolve(args.file)));
    } else if (args.mode === 'pr-body') {
      invariant(args.file, 'Missing path after --pr-body');
      result = validatePullRequestBody(readText(path.resolve(args.file)));
    } else if (args.mode === 'task-input') {
      invariant(args.file, 'Missing path after --task-input');
      result = validateTaskInput(JSON.parse(readText(path.resolve(args.file))));
    } else {
      throw new Error(`Unknown mode: ${args.mode}`);
    }

    if (result.ok === false) {
      process.stderr.write(`${JSON.stringify({ ok: false, ...result })}\n`);
      process.exit(1);
    }
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
