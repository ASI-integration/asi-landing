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

- unpacks the CI-built tarball into `/var/www/asi/releases/<sha>`
- runs `npm ci --omit=dev` in that release folder (no `next build` on the VPS)
- smoke-starts `next start` and fetches `/api/health`, `/`, `/ru`, `/api/version` (SHA must match)
- switches `/var/www/asi/current` **only after** smoke passes
- reloads PM2 **only after** switching `current`
- runs post-switch healthchecks and auto-rolls back on failure

## CI vs VPS responsibilities

- **GitHub Actions** (`.github/workflows/deploy.yml`): lint, typecheck, tests, `next build`, pack `.release.build.json` with the canonical full SHA, upload artifact, SCP artifact + `deploy-artifact.sh`, run deploy on the VPS.
- **VPS**: unpack, runtime `npm ci --omit=dev`, smoke, symlink flip, PM2 reload. No legacy `deploy.sh` / `deploy-release.sh` / VPS `next build` for production.

## Manual rollback (no rebuild)

```bash
ASI_BASE_DIR=/var/www/asi bash scripts/rollback-artifact.sh <existing-release-sha>
```

## Release metadata / inspection

- **Release metadata file**: `/var/www/asi/current/.release.json`
- **Version endpoint**: `GET /api/version` (includes `sha`, `deployedAt`, `releasePath`)
- **Health endpoint**: `GET /api/health` (includes `ok`, `sha`, `deployedAt`)
