#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateStagingFixture } from '../../../../scripts/agent-os/contracts.mjs';

const STAGING_APP_PATH = '/var/www/asi-staging';
const STAGING_PORT = 3001;
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name}`);
  return process.argv[index + 1];
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function buildStagingPreflight({ fixture, identity, repoRoot }) {
  validateStagingFixture(fixture, repoRoot);

  const blockers = [];
  const projectRef = String(identity.projectRef ?? '').trim();
  const appPath = String(identity.appPath ?? '').trim();
  const port = Number(identity.port);
  const requestedSha = String(identity.requestedSha ?? '').trim().toLowerCase();
  const dryRun = identity.dryRun === true;

  if (!PROJECT_REF_PATTERN.test(projectRef)) {
    blockers.push('Staging project ref is missing or invalid');
  }
  if (appPath !== STAGING_APP_PATH) {
    blockers.push(`Staging app path mismatch: expected ${STAGING_APP_PATH}`);
  }
  if (port !== STAGING_PORT) {
    blockers.push(`Staging port mismatch: expected ${STAGING_PORT}`);
  }
  if (!/^[0-9a-f]{40}$/.test(requestedSha)) {
    blockers.push('Requested SHA must be a full 40-character commit hash');
  }
  if (!dryRun) {
    blockers.push('Staging acceptance requires dryRun=true in Phase 2 contract mode');
  }
  if (identity.productionCredentials === true) {
    blockers.push('Production credentials are forbidden for staging acceptance');
  }
  if (identity.mutateStaging === true) {
    blockers.push('Staging mutation is forbidden for this Skill');
  }

  const status = blockers.length > 0 ? 'BLOCKED' : 'READY';
  return {
    schemaVersion: 'asi.agent-os.staging-preflight.v1',
    environment: 'staging',
    status,
    fixtureId: fixture.fixtureId,
    requestedSha: /^[0-9a-f]{40}$/.test(requestedSha) ? requestedSha : null,
    identity: {
      projectRef: PROJECT_REF_PATTERN.test(projectRef) ? projectRef : null,
      appPath,
      port: Number.isInteger(port) ? port : null,
    },
    safety: {
      ...fixture.safety,
      dryRun: true,
      mutateStaging: false,
      networkAccess: false,
    },
    cleanup: fixture.cleanup,
    blockers,
    nextAction: status === 'READY'
      ? 'Build local staging result from the validated fixture; do not SSH or mutate staging.'
      : 'Resolve blockers before any staging action.',
  };
}

function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
  try {
    const fixture = readJson(path.resolve(argument('--fixture')));
    const identity = readJson(path.resolve(argument('--identity')));
    const preflight = buildStagingPreflight({ fixture, identity, repoRoot });
    const ok = preflight.status === 'READY';
    const payload = { ok, preflight };
    if (ok) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    else {
      process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
      process.exit(1);
    }
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
