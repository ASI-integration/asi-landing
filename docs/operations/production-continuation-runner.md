# ASI Production Continuation Runner

The continuation runner keeps the mechanical production loop alive even when the ChatGPT UI or Work stream is interrupted.

## Current task: Telegram guest text communication

Definition of Done:

1. current `origin/main` is deployed to `https://asi-global.ru`;
2. production `/api/health` is healthy;
3. production `/api/version` reports the same SHA as current `main`;
4. `Communication Production Completion v1` in `text_acceptance` mode passes;
5. `main` has not advanced while the acceptance was running.

If acceptance or deploy fails and `--watch-main` is enabled, the runner does not exit. It records the blocker and waits for a new `main` commit, then automatically repeats deploy + verification + acceptance.

## Safety

Production-changing behavior is opt-in. Without `--allow-production`, the runner only probes state and waits.

The runner never edits code, creates commits, or invents a fix. A semantic failure becomes a visible blocker. Once a fix is merged to `main`, `--watch-main` detects the new SHA and resumes automatically.

GitHub Production environment approvals are only submitted when `--allow-production` is present.

## Run

From the repository:

```powershell
npm run ops:continuation -- --allow-production --watch-main --max-hours 8
```

The process can be started detached on Windows:

```powershell
Start-Process -WindowStyle Hidden -FilePath node -WorkingDirectory "C:\Users\Admin\Documents\GitHub\asi-landing" -ArgumentList @(
  "scripts/production-continuation-runner.mjs",
  "--task", "telegram-text",
  "--repo", "ASI-integration/asi-landing",
  "--allow-production",
  "--watch-main",
  "--max-hours", "8"
)
```

## Status

```powershell
npm run ops:continuation:status
```

Default persistent state is stored outside the repository:

```text
~/.asi/continuation/telegram-text/status.json
~/.asi/continuation/telegram-text/runner.log
~/.asi/continuation/telegram-text/runner.lock
```

Important phases include:

- `production_probe`
- `deploy_dispatch`
- `deploy_wait`
- `post_deploy_verify`
- `acceptance_dispatch`
- `acceptance_wait`
- `blocked_waiting_for_new_main`
- `done`

The status file is updated atomically and includes a heartbeat timestamp, current SHA, production SHA, workflow run IDs/URLs, and the current blocker when one exists.
