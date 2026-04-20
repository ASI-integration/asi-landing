# Atomic deploy (releases + current symlink)

## Goals

- **No in-place builds** in the live app directory.
- **Atomic switch** between tested releases.
- **Rollback** is instant and does not rebuild.
- **Only exact commit SHAs** from `origin/main` are deployable.
- **Same code path** for manual deploy and GitHub Actions deploy.

## Filesystem layout (VPS)

Base directory: `/var/www/asi`

- `/var/www/asi/releases/<commit-sha>/` — immutable release folders (git worktrees)
- `/var/www/asi/current` — symlink to the active release
- `/var/www/asi/shared/.env.production.live` — shared production env (secrets + release metadata)

PM2 must run the app from:

- `/var/www/asi/current`

## Canonical deploy script

Script:

- `scripts/deploy-release.sh`

It:

- creates (or reuses) `/var/www/asi/releases/<sha>`
- installs deps with `npm ci` in that fresh release folder
- runs release gates (typecheck + golden tests + build + local smoke start)
- switches `/var/www/asi/current` **only after** all gates pass
- reloads PM2 **only after** switching `current`
- runs post-switch healthchecks and auto-rolls back on failure

## Manual deploy

From the deploy controller repo (e.g. `~/asi-landing` on the VPS):

```bash
git fetch origin
git rev-parse origin/main
ASI_BASE_DIR=/var/www/asi ./scripts/deploy-release.sh <commit-sha>
```

## Rollback

Rollback is a symlink flip back to the previous release, then a PM2 reload.

If you know the previous release path:

```bash
ln -sfn /var/www/asi/releases/<previous-sha> /var/www/asi/current
pm2 startOrReload /var/www/asi/current/ecosystem.config.cjs --only asi-landing
```

## Release metadata / inspection

- **Release metadata file**: `/var/www/asi/current/.release.json`
- **Version endpoint**: `GET /api/version` (includes `sha`, `deployedAt`, `releasePath`)
- **Health endpoint**: `GET /api/health` (includes `ok`, `sha`, `deployedAt`)

