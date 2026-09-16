#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name}`);
  return process.argv[index + 1];
}

function git(repoRoot, args) {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim().toLowerCase();
}

export function verifyReleaseIdentity({ repoRoot, requestedSha, sourceRef }) {
  const requested = String(requestedSha ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(requested)) {
    throw new Error('Requested SHA must be a full 40-character commit hash');
  }
  const sourceSha = git(repoRoot, ['rev-parse', sourceRef]);
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) {
    throw new Error('Source ref did not resolve to a full commit hash');
  }
  const identityMatched = requested === sourceSha;
  return {
    schemaVersion: 'asi.agent-os.release-identity.v1',
    requestedSha: requested,
    sourceRef,
    sourceSha,
    identityMatched,
    status: identityMatched ? 'MATCH' : 'BLOCKED',
    blockers: identityMatched ? [] : ['Requested SHA does not match source ref SHA'],
  };
}

function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
  try {
    const result = verifyReleaseIdentity({
      repoRoot,
      requestedSha: argument('--requested'),
      sourceRef: argument('--source'),
    });
    const payload = { ok: result.identityMatched, identity: result };
    if (result.identityMatched) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
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
