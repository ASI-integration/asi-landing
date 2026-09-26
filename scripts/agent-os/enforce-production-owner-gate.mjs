#!/usr/bin/env node
/**
 * Shared fail-closed production owner-gate enforcer (AO-003).
 * Typed confirmation / workflow_dispatch phrases never authorize mutation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateOwnerGate } from './contracts.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) return null;
  return process.argv[index + 1];
}

function die(message) {
  console.error(`FAIL production-owner-gate: ${message}`);
  process.exit(1);
}

function parseJson(raw, label) {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    die(`${label} is missing`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    die(`${label} is malformed JSON: ${error.message}`);
  }
}

function loadGate(rawOrPath) {
  const value = String(rawOrPath ?? '').trim();
  if (!value) die('owner gate evidence is missing');
  if (value.startsWith('{')) return parseJson(value, 'owner_gate_json');
  const absolute = path.isAbsolute(value) ? value : path.join(repoRoot, value);
  if (!fs.existsSync(absolute)) die(`owner gate file not found: ${value}`);
  return parseJson(fs.readFileSync(absolute, 'utf8'), 'owner_gate_file');
}

export function enforceProductionOwnerGate({
  gate,
  requestedAction,
  environmentIdentity = 'production',
  targetIdentity = null,
  repoRoot: root = repoRoot,
} = {}) {
  if (!gate || typeof gate !== 'object') {
    throw new Error('missing gate');
  }
  if (environmentIdentity !== 'production') {
    throw new Error(`environment identity must be production (got ${environmentIdentity})`);
  }
  if (!requestedAction) {
    throw new Error('requested action is required');
  }

  // Consumed must fail before other authorization paths.
  if (gate.status === 'consumed') {
    throw new Error('consumed gate cannot authorize action');
  }

  // Fail closed on typed confirmation before treating any non-approved status as authorizing.
  if (gate.typedConfirmation?.present === true && gate.typedConfirmation?.countsAsOwnerApproval !== false) {
    throw new Error('typed confirmation must never count as owner approval');
  }
  if (gate.typedConfirmation?.present === true && gate.status !== 'approved') {
    throw new Error('typed confirmation alone is not owner approval');
  }

  if (gate.status === 'missing' || gate.status === 'rejected' || gate.status === 'expired') {
    throw new Error(`owner gate status ${gate.status} cannot authorize action`);
  }

  if (!Object.prototype.hasOwnProperty.call(gate, 'target') || gate.target == null || gate.target === '') {
    throw new Error('malformed gate: target is missing');
  }
  if (gate.target !== 'production') {
    throw new Error(`staging/non-production gate target cannot authorize production (got ${gate.target})`);
  }
  if (gate.action !== requestedAction) {
    throw new Error(`action mismatch: gate=${gate.action} requested=${requestedAction}`);
  }
  if (targetIdentity && typeof targetIdentity === 'object') {
    for (const key of Object.keys(targetIdentity)) {
      if (gate.identity?.[key] !== targetIdentity[key]) {
        throw new Error(`target identity mismatch for ${key}`);
      }
    }
  }

  const expected = {
    taskId: gate.taskId,
    action: requestedAction,
    target: 'production',
    identity: gate.identity,
    allowedSideEffect: gate.allowedSideEffect,
    postActionVerification: gate.postActionVerification,
    scope: gate.authorization?.scope,
    taskCycle: gate.authorization?.taskCycle,
  };
  validateOwnerGate(gate, expected, root);
  return {
    ok: true,
    action: gate.action,
    target: gate.target,
    taskId: gate.taskId,
    identity: gate.identity,
  };
}

function main() {
  const requestedAction = arg('--action');
  const environmentIdentity = arg('--environment') ?? 'production';
  const gateRaw = arg('--gate') ?? arg('--gate-json');
  const identityRaw = arg('--identity-json');
  const targetIdentity = identityRaw ? parseJson(identityRaw, 'identity_json') : null;
  const gate = loadGate(gateRaw);
  try {
    const result = enforceProductionOwnerGate({
      gate,
      requestedAction,
      environmentIdentity,
      targetIdentity,
      repoRoot,
    });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } catch (error) {
    die(error.message);
  }
}

const invokedAsCli = (() => {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(path.resolve(process.argv[1])).toLowerCase()
      === fs.realpathSync(fileURLToPath(import.meta.url)).toLowerCase();
  } catch {
    return false;
  }
})();
if (invokedAsCli) {
  main();
}
