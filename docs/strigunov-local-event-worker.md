# Strigunov local event worker (Windows notebook)

This is a small local execution bridge for the Strigunov launch only.
It does NOT manage Booking Ops, Kim, payments, or the general ASI engine.

1. GitHub Actions produces a checked, bot-authored next-task handoff in issue #416.
2. The Windows process cheaply checks that issue every 30 seconds. This is
   transport polling only: no model calls while idle.
3. Only one hardcoded safe phase is executable: after a merged Strigunov
   anti-abuse PR, run a bounded nonproduction CRM acceptance job.
4. It refuses to start when an agent process is already running, the tracker
   is closed, a task is not whitelisted, the exact remote main SHA cannot be
   verified, or its per-task branch/worktree already exists.
5. It creates a new isolated worktree from verified main and uses a
   workspace-write Codex sandbox, not an existing dirty worktree.

## Prerequisites

- Notebook remains powered on and connected to GitHub.
- gh auth status and codex login status succeed.
- git, node, gh, and codex are available on PATH.
- GitHub Actions handoff must be merged and passing CI.

## Commands

Dry-run (no branches or model calls):
    node scripts/strigunov-local-runner.mjs --once

Stay active without executing tasks:
    node scripts/strigunov-local-runner.mjs --watch

Run approved nonproduction task on eligible event:
    node scripts/strigunov-local-runner.mjs --watch --execute

Only the last command may start a Codex session. It does not register
a Windows scheduled task by itself.

Reports, task reservation, and watch.lock are stored under the current
user's home / asi-strigunov-2x / local-worker.
A crashed attempt remains reserved. Inspect before manual recovery;
do not delete a lock that belongs to a live process.

## Approval / limits

The worker does not push, open PRs, merge, deploy, migrate, access live CRM,
change secrets/config/DNS, submit applicant data, send guest messages or publish.
A successful local result is a CODE checkpoint, not launch READY.
Production rollout, real CRM verification and publication require owner approval.

If conditions do not match a known task, the process remains quiet.
Tests: node --test scripts/__tests__/strigunov-local-runner.test.mjs
