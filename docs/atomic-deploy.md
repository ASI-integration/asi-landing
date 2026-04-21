# Atomic deploy (releases + current symlink)

## Goals

- **No in-place builds** in the live app directory.
- **Atomic switch** between tested releases.
- **Rollback** is instant and does not rebuild.
- **Only exact commit SHAs** from `origin/main` are deployable (enforced in CI + deploy script).
- **Same artifact** is built in GitHub Actions, shipped as `.tgz`, and unpacked on the VPS.

## Filesystem layout (VPS)

Base directory: `/var/www/asi`

- `/var/www/asi/releases/<commit-sha>/` — immutable release folders (from CI artifact unpack)
- `/var/www/asi/current` — symlink to the active release
- `/var/www/asi/shared/.env.production.live` — shared production env (secrets + release metadata)

PM2 must run the app from:

- `/var/www/asi/current`

## Canonical deploy script

Script:

- `scripts/deploy-artifact.sh`

It:

- unpacks the CI-built tarball into `/var/www/asi/releases/<sha>` (includes `node_modules` and `release-meta.json`)
- validates required paths and that `release-meta.json` `gitSha` matches the release id
- switches `/var/www/asi/current` **atomically** (`ln` + `mv -Tf`)
- reloads PM2 **once** against `current/ecosystem.config.cjs` (Next CLI via `node`, cwd `/var/www/asi/current`)
- runs post-switch healthchecks (retries until `/api/version` matches artifact SHA) and auto-rolls back on failure

## CI vs VPS responsibilities

- **GitHub Actions** (`.github/workflows/deploy.yml`): lint, typecheck, tests, `next build`, `npm prune --omit=dev`, bundle prod `node_modules`, write `release-meta.json` with canonical `gitSha`, upload artifact, SCP artifact + `deploy-artifact.sh`, run deploy on the VPS.
- **VPS**: unpack, preflight, symlink flip, PM2 reload. No `npm install` / `npm ci` / `next build` on the VPS for normal deploy. No legacy `deploy.sh` / `deploy-release.sh` / VPS `next build` for production.

## Manual rollback (no rebuild)

```bash
ASI_BASE_DIR=/var/www/asi bash scripts/rollback-artifact.sh <existing-release-sha>
```

## Release metadata / inspection

- **Release metadata file**: `/var/www/asi/current/.release.json`
- **Version endpoint**: `GET /api/version` (includes `sha`, `deployedAt`, `releasePath`)
- **Health endpoint**: `GET /api/health` (includes `ok`, `sha`, `deployedAt`)
