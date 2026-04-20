# Release discipline (deterministic, release-gated)

## Root causes this system addresses

- **Logic drift** between canonical policy, runtime selector, upstream extraction, and UI.
- **Local-only fixes** that never land in `origin/main` but get deployed manually.
- **Dirty live directory builds** (build artifacts and installs happen “where the app runs”).
- `npm ci` failures caused by stale or inconsistent `node_modules` states.
- **PM2 restarts against incomplete builds** (restarts treated as “deploy done”).
- GitHub deploy workflow and manual deploy path diverged (two deploy systems).
- Deploys were **reactive** instead of **release-gated**.

## Rules

- **Deploy only by exact commit SHA** (canonical full SHA from `git rev-parse HEAD` in CI).
- **Deploy only SHAs reachable from `origin/main`** (VPS git-worktree path retired; discipline remains via branch protection + CI on `main`).
- **Never build in `/var/www/asi/current`**.
- **Releases are immutable folders** under `/var/www/asi/releases/<sha>`.
- **Switch is atomic**: only the `current` symlink changes.
- **PM2 reload happens only after** a release passes gates and `current` is switched.
- **A failed build/test never becomes live**.

## Release gates (must pass before switch)

**GitHub Actions** runs before packaging:

- `npm ci`
- `npm run lint`
- `npm run typecheck`
- `npm run test:location-golden`
- `npm run build`

**`scripts/deploy-artifact.sh`** runs on the VPS before switching `current`:

- `npm ci --omit=dev` in the fresh release folder
- **Local smoke start + fetch**:
  - start `next start` on a local port
  - fetch `/api/health`, `/`, `/ru`, `/api/version`

If any gate fails, deploy exits non-zero and does **not** switch `current`.

## Post-switch healthchecks (must pass after switch)

After switching `current` and reloading PM2, the deploy script checks:

- `http://127.0.0.1:3000/api/health`
- `http://127.0.0.1:3000/api/version` (and verifies the SHA matches, when available)

If healthcheck fails, deploy **auto-rolls back** to the previous `current` target and reloads PM2.

## Unified deploy path (GitHub Actions only)

- GitHub Actions builds the artifact and runs `scripts/deploy-artifact.sh <full-sha> /tmp/asi-release-<full-sha>.tgz` on the VPS (script is copied via SCP; no dependency on a git-updated clone for the deploy entrypoint).
- Legacy VPS-build scripts (`deploy.sh`, `scripts/deploy-release.sh`, root `rollback.sh`) are **retired** and exit with an error if invoked.
