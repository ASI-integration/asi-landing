#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadChangeMap,
  selectChecks,
  validateTaskPreflight,
} from '../../../../scripts/agent-os/contracts.mjs';

function fail(message) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exit(1);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) fail(`Missing ${name}`);
  return process.argv[index + 1];
}

function git(repoRoot, args) {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();
}

function lines(value) {
  return value ? value.split(/\r?\n/).filter(Boolean) : [];
}

try {
  const taskPath = path.resolve(argument('--task'));
  const baseRef = argument('--base');
  const repoRoot = git(process.cwd(), ['rev-parse', '--show-toplevel']);
  const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
  if (path.normalize(repoRoot) !== path.normalize(skillRoot)) fail('Skill must run inside its repository checkout');

  const input = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
  const baselineSha = git(repoRoot, ['rev-parse', baseRef]);
  const headRef = git(repoRoot, ['branch', '--show-current']);
  const paths = [...new Set([
    ...lines(git(repoRoot, ['diff', '--name-only', `${baseRef}...HEAD`])),
    ...lines(git(repoRoot, ['diff', '--name-only'])),
    ...lines(git(repoRoot, ['diff', '--cached', '--name-only'])),
    ...lines(git(repoRoot, ['ls-files', '--others', '--exclude-standard'])),
  ])].sort();
  const forbiddenPaths = paths.filter((changedPath) => changedPath === 'tmp' || changedPath.startsWith('tmp/'));
  const selected = selectChecks(paths, loadChangeMap(repoRoot));
  const redActions = [...new Set([...(input.redActions ?? []), ...selected.redActions])];
  const classification = redActions.length > 0 ? 'red' : input.classification;
  const red = classification === 'red';

  const preflight = {
    schemaVersion: 'asi.agent-os.task-preflight.v1',
    task: input.task,
    repository: { name: 'ASI-integration/asi-landing', baselineSha, headRef },
    classification,
    redActions,
    ownerGate: { required: red, status: red ? 'missing' : 'not_required' },
    changeSet: { paths, protectedPaths: selected.protectedPaths, forbiddenPaths },
    validation: {
      checks: selected.checks,
      focusedTests: input.focusedTests ?? [],
      broadSuiteRequired: false,
    },
    safety: { noProductionWrites: true, noExternalActions: true, secretsAccessed: false },
    status: red ? 'AWAITING_OWNER' : forbiddenPaths.length > 0 ? 'BLOCKED' : 'READY',
  };

  validateTaskPreflight(preflight);
  process.stdout.write(`${JSON.stringify({ ok: true, matchedRuleIds: selected.matchedRuleIds, preflight }, null, 2)}\n`);
} catch (error) {
  fail(error.message);
}
