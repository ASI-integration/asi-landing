import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertUniqueMigrationPrefixes,
  countTrackedMigrations,
  listTrackedMigrationFiles,
  migrationVersionPrefix,
  summarizeTrackedMigrations,
} from '../migration-count.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const checkScript = path.join(repoRoot, 'scripts/agent-os/check-migration-count-docs.mjs');

test('tracked migration count matches supabase/migrations/*.sql files', () => {
  const files = listTrackedMigrationFiles(repoRoot);
  assert.equal(countTrackedMigrations(repoRoot), files.length);
  assert.ok(files.length > 0);
  assert.ok(files.every((filename) => filename.endsWith('.sql')));
});

test('tracked migration prefixes stay unique', () => {
  const summary = summarizeTrackedMigrations(repoRoot);
  assert.equal(summary.count, summary.uniquePrefixCount);
  assert.doesNotThrow(() => assertUniqueMigrationPrefixes(repoRoot));
});

test('migrationVersionPrefix rejects invalid filenames', () => {
  assert.throws(
    () => migrationVersionPrefix('invalid.sql'),
    /numeric prefix/,
  );
});

test('bootstrap runbook passes migration-count doc enforcement', () => {
  const run = spawnSync(process.execPath, [checkScript], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const output = JSON.parse(run.stdout.trim());
  assert.equal(output.ok, true);
  assert.equal(output.trackedMigrationCount, countTrackedMigrations(repoRoot));
});

test('migration-count doc enforcement fails on hard-coded counts', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'asi-migration-count-'));
  const docPath = path.join(tempRoot, 'docs/BOOKING_OPS_STAGING_BOOTSTRAP.md');
  fs.mkdirSync(path.dirname(docPath), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, 'supabase/migrations'), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, 'supabase/migrations/20260101000000_example_v1.sql'), '-- example');
  fs.writeFileSync(docPath, 'The repository contains 99 ordered SQL files in `supabase/migrations`.\n');

  const patchedCheck = `
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repoRoot = ${JSON.stringify(tempRoot)};
const content = fs.readFileSync(path.join(repoRoot, 'docs/BOOKING_OPS_STAGING_BOOTSTRAP.md'), 'utf8');
const match = content.match(/\\b\\d+\\s+ordered\\s+SQL\\s+files?\\b/iu);
if (match) {
  process.stderr.write(JSON.stringify({ ok: false, match: match[0] }) + '\\n');
  process.exit(1);
}
process.stdout.write(JSON.stringify({ ok: true }) + '\\n');
`.trim();

  const tempCheck = path.join(tempRoot, 'check.mjs');
  fs.writeFileSync(tempCheck, patchedCheck);
  const run = spawnSync(process.execPath, [tempCheck], { cwd: tempRoot, encoding: 'utf8' });
  assert.equal(run.status, 1);
  const output = JSON.parse(run.stderr.trim());
  assert.equal(output.ok, false);
  assert.match(output.match, /99 ordered SQL files/i);
});
