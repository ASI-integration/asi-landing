#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildBlockedTaskPreflight,
  buildTaskPreflight,
  loadChangeMap,
} from '../../../../scripts/agent-os/contracts.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name}`);
  return process.argv[index + 1];
}

function git(repoRoot, args) {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();
}

function lines(value) {
  return value ? value.split(/\r?\n/).filter(Boolean) : [];
}

let input = {};
let repoRoot = process.cwd();
let map = null;
let paths = [];
let repository = {};

try {
  const taskPath = path.resolve(argument('--task'));
  const baseRef = argument('--base');
  repoRoot = git(process.cwd(), ['rev-parse', '--show-toplevel']);
  const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
  if (path.normalize(repoRoot) !== path.normalize(skillRoot)) throw new Error('Skill must run inside its repository checkout');

  input = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
  const baselineSha = git(repoRoot, ['rev-parse', baseRef]);
  const headRef = git(repoRoot, ['branch', '--show-current']);
  repository = { name: 'ASI-integration/asi-landing', baselineSha, headRef };
  paths = [...new Set([
    ...lines(git(repoRoot, ['diff', '--name-only', `${baseRef}...HEAD`])),
    ...lines(git(repoRoot, ['diff', '--name-only'])),
    ...lines(git(repoRoot, ['diff', '--cached', '--name-only'])),
    ...lines(git(repoRoot, ['ls-files', '--others', '--exclude-standard'])),
  ])].sort();
  map = loadChangeMap(repoRoot);
  const result = buildTaskPreflight({ input, repository, paths, map });
  process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
} catch (error) {
  try {
    map ??= loadChangeMap(repoRoot);
    const blocked = buildBlockedTaskPreflight({ input, repository, paths, map, reason: error.message });
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message, ...blocked }, null, 2)}\n`);
  } catch (blockedError) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message, blockedArtifactError: blockedError.message })}\n`);
  }
  process.exit(1);
}
