#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateOwnerGate,
  validateProductionPreflight,
} from '../../../../scripts/agent-os/contracts.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) return null;
  return process.argv[index + 1];
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function containsSecretValues(value) {
  const text = JSON.stringify(value);
  return /("-----BEGIN [A-Z ]+PRIVATE KEY-----"|sk_live_|ghp_[A-Za-z0-9]{20,}|xox[baprs]-)/.test(text);
}

export function buildProductionRolloutReport({
  repoRoot,
  requestedAction,
  target = 'production',
  requestedSha,
  sourceSha,
  identityMatched,
  gate = null,
  expected = null,
}) {
  if (containsSecretValues({ gate, expected, requestedAction, target, requestedSha, sourceSha })) {
    throw new Error('Secret values are forbidden in production rollout inputs');
  }

  const preflight = {
    schemaVersion: 'asi.agent-os.production-preflight.v1',
    taskId: expected?.taskId ?? 'production-rollout-preflight',
    mode: 'read-only-preflight',
    dispatchAllowed: false,
    mutationAllowed: false,
    secretValuesAllowed: false,
    requestedAction,
    evidence: [
      'Production Skill defaulted to read-only preflight.',
      'No workflow dispatch implementation is invoked by this Skill.',
    ],
    status: 'PREFLIGHT_ONLY',
  };

  let ownerGateStatus = 'missing';
  let status = 'AWAITING_OWNER';
  const blockers = [];

  if (!identityMatched) {
    status = 'BLOCKED';
    blockers.push('Release identity mismatch');
    preflight.status = 'BLOCKED';
  } else if (gate) {
    try {
      validateOwnerGate(gate, expected, repoRoot);
      if (gate.action !== requestedAction) {
        throw new Error('Owner gate action does not match requested action');
      }
      if (gate.target !== target) {
        throw new Error('Owner gate target does not match production target');
      }
      ownerGateStatus = gate.status;
      // Agent OS v0 still does not dispatch even with a valid gate.
      status = 'PREFLIGHT_ONLY';
      preflight.status = 'PREFLIGHT_ONLY';
      preflight.evidence.push('Owner gate validated locally; dispatch remains disabled in this Skill.');
    } catch (error) {
      status = 'BLOCKED';
      ownerGateStatus = gate.status ?? 'invalid';
      blockers.push(error.message);
      preflight.status = 'BLOCKED';
    }
  } else {
    preflight.status = 'AWAITING_OWNER';
  }

  validateProductionPreflight(preflight, repoRoot);

  return {
    schemaVersion: 'asi.agent-os.production-rollout-report.v1',
    status,
    requestedAction,
    target,
    requestedSha,
    sourceSha,
    identityMatched: Boolean(identityMatched),
    dispatchAllowed: false,
    mutationAllowed: false,
    ownerGateStatus,
    evidence: preflight.evidence,
    blockers,
    preflight,
  };
}

function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
  try {
    const expectedPath = argument('--expected');
    const gatePath = argument('--gate');
    if (!expectedPath) throw new Error('Missing --expected');
    const expected = readJson(path.resolve(expectedPath));
    const gate = gatePath ? readJson(path.resolve(gatePath)) : null;
    const report = buildProductionRolloutReport({
      repoRoot,
      requestedAction: expected.action,
      target: expected.target,
      requestedSha: expected.identity?.sha,
      sourceSha: expected.identity?.sha,
      identityMatched: true,
      gate,
      expected,
    });
    const ok = report.status !== 'BLOCKED';
    const payload = { ok, report };
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
