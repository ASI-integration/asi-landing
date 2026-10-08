#!/usr/bin/env node
/**
 * A tiny, fail-closed GitHub-event bridge for local ASI coding agents.
 *
 * GitHub Actions reacts immediately; this local transport polls a small
 * GitHub API response every 30s without invoking an LLM. A Codex task
 * starts at most once, only for a hardcoded safe launch phase.
 *
 * Usage: node scripts/strigunov-local-runner.mjs [--once|--watch] [--execute]
 * Default is --once dry-run. Executing needs --watch --execute.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, open, readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';

export const ISSUE = 416;
export const MARKER = '<!-- ASI-STRIGUNOV-EVENT-CONTROLLER-V1 -->';
export const REPO = 'ASI-integration/asi-landing';
export const DEFAULT_INTERVAL_MS = 30_000;

export function chooseTask(issue, comments) {
  if (!issue || issue.state !== 'open') return null;
  const bot = [...(comments ?? [])].reverse().find((item) =>
    item?.user?.login === 'github-actions[bot]' &&
    typeof item.body === 'string' && item.body.startsWith(MARKER));
  if (!bot) return null;
  // Untrusted issue text is never executed as a command or instruction.
  const phase = bot.body.match(/^- Current phase: \*\*(.+?)\*\*$/m)?.[1];
  if (phase !== 'P1 - isolated CRM acceptance') return null;
  if (!(issue.body ?? '').includes('- [ ] End-to-end test of lead submission')) return null;
  if (!/^- Anti-abuse code: Merged PR #\d+$/m.test(bot.body)) return null;
  const anti = bot.body.match(/^- Anti-abuse code: Merged PR #(\d+)$/m)?.[1];
  return { id: 'crm-acceptance', antiPr: anti };
}

export function taskKey(task, mainSha) {
  if (task?.id !== 'crm-acceptance' || !/^\d+$/.test(task.antiPr ?? '') ||
      !/^[0-9a-f]{40}$/.test(mainSha ?? '')) return null;
  return task.id + '-pr' + task.antiPr;
}

export function branchFor(key) {
  if (!/^crm-acceptance-pr\d+$/.test(key ?? '')) throw new Error('Unsafe job key');
  return 'dc/strigunov-autojob-' + key;
}

export function instructionFor(task, expectedSha) {
  if (task?.id !== 'crm-acceptance') throw new Error('No authorized task contract');
  return [
    'ASI / Strigunov, nonproduction CRM acceptance only.',
    'This is a bounded, locally sandboxed job. Work exclusively in this NEW isolated worktree.',
    'Starting origin/main SHA: ' + expectedSha,
    'Objective: implement or tighten the smallest deterministic, nonproduction acceptance',
    'test that proves a Strigunov-tagged public lead is persisted to the CRM repository',
    'and visible to an authorized operator queue. Use a real isolated local/test store',
    'if available; do not call a mock-only test a persistence proof.',
    'Inspect repository instructions, CRM contract, existing tests and related issues.',
    'Add focused regression tests/acceptance scripts only; if fixture database credentials',
    'or safe staging isolation are unavailable, leave an exact executable verification plan.',
    'Run at most 1-2 focused test files (~30 tests), TS typecheck, touched-file ESLint.',
    'DO NOT modify production, staging or remote databases, secrets, DNS, migrations,',
    'release/deploy workflows, payments, guest messages, or externally send forms.',
    'DO NOT touch any other worktree, rename existing branches, push, merge, or deploy.',
    'DO NOT publish, claim ready for public traffic, or submit synthetic production leads.',
    'Make a local commit only after green focused tests. Otherwise preserve diff.',
    'Produce a concise Russian result: exact evidence, commit/diff, gaps and next safe action.',
  ].join('\n');
}

function api(path) {
  const output = execFileSync('gh', ['api', path], { encoding: 'utf8', timeout: 20000, windowsHide: true });
  return JSON.parse(output);
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 25000, windowsHide: true }).trim();
}

function otherAgentActive() {
  if (process.platform !== 'win32') return true; // intended only for authorized Windows notebook
  const output = execFileSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command',
      "(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('codex.exe','claude.exe') } | Measure-Object).Count"],
    { encoding: 'utf8', timeout: 15000, windowsHide: true });
  return Number(output.trim()) > 0 || !/^\d+$/.test(output.trim());
}

function rootPaths() {
  const home = homedir();
  return {
    repo: join(home, 'Documents', 'GitHub', 'asi-landing'),
    jobs: join(home, 'Documents', 'GitHub'),
    state: join(home, 'asi-strigunov-2x', 'local-worker'),
  };
}

async function readState(path) {
  if (!existsSync(path)) return {};
  return JSON.parse(await readFile(path, 'utf8'));
}

async function tick({ execute, paths, client = { api, git, otherAgentActive } }) {
  const issue = client.api('/repos/' + REPO + '/issues/' + ISSUE);
  if (issue.state !== 'open') return { status: 'BLOCKED', reason: 'Launch issue closed' };
  const comments = client.api('/repos/' + REPO + '/issues/' + ISSUE + '/comments?per_page=100');
  const task = chooseTask(issue, comments);
  if (!task) return { status: 'IDLE', reason: 'No authorized next local task' };
  if (client.otherAgentActive()) return { status: 'BUSY', reason: 'Existing Codex/Claude process' };
  const remoteMain = client.git(paths.repo, ['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0];
  if (!/^[0-9a-f]{40}$/.test(remoteMain)) return { status: 'BLOCKED', reason: 'Cannot verify main' };
  const key = taskKey(task, remoteMain);
  const statePath = join(paths.state, 'state.json');
  const state = await readState(statePath);
  if (state[key]) return { status: 'DONE_OR_ATTEMPTED', key };
  const branch = branchFor(key);
  const worktree = join(paths.jobs, 'asi-landing-strigunov-autojob-' + key);
  if (existsSync(worktree)) return { status: 'BLOCKED', reason: 'Task worktree already exists' };
  if (client.git(paths.repo, ['branch', '--list', branch])) {
    return { status: 'BLOCKED', reason: 'Task branch already exists' };
  }
  if (!execute) return { status: 'DRY_RUN', key, branch, worktree };
  client.git(paths.repo, ['fetch', 'origin', 'main']);
  const fetchedSha = client.git(paths.repo, ['rev-parse', 'origin/main']);
  if (fetchedSha !== remoteMain) throw new Error('Main moved during fetch; fail closed');
  // Reserve only after remote SHA is verified, before creating the new branch.
  await mkdir(paths.state, { recursive: true });
  state[key] = { status: 'attempting', startedAt: new Date().toISOString() };
  await writeFile(statePath, JSON.stringify(state, null, 2) + '\n', { flag: 'w' });
  client.git(paths.repo, ['worktree', 'add', '-b', branch, worktree, fetchedSha]);
  const prompt = instructionFor(task, remoteMain);
  const promptPath = join(paths.state, key + '-prompt.txt');
  const resultPath = join(paths.state, key + '-result.md');
  const logPath = join(paths.state, key + '-output.log');
  await writeFile(promptPath, prompt, 'utf8');
  const stream = await open(logPath, 'a');
  try {
    const proc = spawn('codex', ['exec', '-s', 'workspace-write', '-C', worktree,
      '--output-last-message', resultPath, prompt], {
      cwd: worktree, windowsHide: true,
      stdio: ['ignore', stream.fd, stream.fd],
    });
    state[key] = { status: 'started', pid: proc.pid, startedAt: new Date().toISOString() };
    await writeFile(statePath, JSON.stringify(state, null, 2) + '\n');
    const exitCode = await new Promise((res, rej) => {
      proc.on('error', rej);
      proc.on('exit', (code) => res(code));
    });
    state[key] = { status: exitCode === 0 ? 'completed' : 'failed',
      exitCode, completedAt: new Date().toISOString(), worktree };
    await writeFile(statePath, JSON.stringify(state, null, 2) + '\n');
    return { status: exitCode === 0 ? 'COMPLETED' : 'FAILED', key, worktree };
  } finally {
    await stream.close();
  }
}

export async function main(args = process.argv.slice(2)) {
  const watch = args.includes('--watch');
  const execute = args.includes('--execute');
  if (execute && !watch) throw new Error('Execution requires explicit --watch --execute');
  const paths = rootPaths();
  let lock;
  if (watch) {
    await mkdir(paths.state, { recursive: true });
    try { lock = await open(join(paths.state, 'watch.lock'), 'wx'); }
    catch { throw new Error('Another watcher owns watch.lock. Inspect before retrying.'); }
    await lock.writeFile(String(process.pid));
  }
  let previous = '';
  try {
    do {
      try {
        const result = await tick({ execute, paths });
        const summary = JSON.stringify(result);
        if (result.status !== 'IDLE' && result.status !== 'DONE_OR_ATTEMPTED' && summary !== previous) {
          console.log(new Date().toISOString(), summary);
        }
        previous = summary;
      } catch (error) {
        console.error('BLOCKED:', error?.message ?? String(error));
      }
      if (!watch) break;
      await new Promise((resolve) => setTimeout(resolve, DEFAULT_INTERVAL_MS));
    } while (true);
  } finally {
    if (lock) {
      await lock.close();
      await unlink(join(paths.state, 'watch.lock'));
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
