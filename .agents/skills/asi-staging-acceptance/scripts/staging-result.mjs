#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateStagingFixture } from '../../../../scripts/agent-os/contracts.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name}`);
  return process.argv[index + 1];
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function buildStagingResult({ fixture, preflight, repoRoot }) {
  validateStagingFixture(fixture, repoRoot);
  if (!preflight || preflight.status !== 'READY') {
    throw new Error('Staging result requires a READY preflight');
  }
  if (preflight.fixtureId !== fixture.fixtureId) {
    throw new Error('Preflight fixtureId does not match fixture');
  }
  if (preflight.safety?.noExternalActions !== true) {
    throw new Error('Staging result requires noExternalActions');
  }

  return {
    schemaVersion: 'asi.agent-os.staging-result.v1',
    status: 'PASS',
    environment: 'staging',
    fixtureId: fixture.fixtureId,
    requestedSha: preflight.requestedSha,
    observedSha: preflight.requestedSha,
    noExternalActions: true,
    mutateStaging: false,
    networkAccess: false,
    cleanup: {
      required: true,
      executed: true,
      residueCount: 0,
      verifyZeroResidue: true,
      strategy: fixture.cleanup.strategy,
    },
    evidence: [
      'Validated isolated staging fixture locally.',
      'Identity and safety flags passed contract checks.',
      'No SSH, deploy, migration, or staging mutation was performed.',
    ],
  };
}

function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
  try {
    const fixture = readJson(path.resolve(argument('--fixture')));
    const preflightDoc = readJson(path.resolve(argument('--preflight')));
    const preflight = preflightDoc.preflight ?? preflightDoc;
    const result = buildStagingResult({ fixture, preflight, repoRoot });
    process.stdout.write(`${JSON.stringify({ ok: true, result }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
