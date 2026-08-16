#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(
  repoRoot,
  'docs',
  'operations',
  'partner-production-rollout-v1',
  'manifest.json',
);

export const EXPECTED_PARTNER_MIGRATIONS = Object.freeze([
  '20260816144742_partner_property_knowledge_schema_completion_v1.sql',
  '20260815102111_partner_communication_durable_state_v1.sql',
  '20260815130000_partner_authenticated_inbox_v1.sql',
  '20260815160000_partner_communication_brain_v1.sql',
  '20260815190000_partner_service_recovery_loop_v1.sql',
  '20260815210000_partner_review_reputation_engine_v1.sql',
  '20260815230000_partner_revenue_shadow_pricing_v1.sql',
]);

export const EXPECTED_HISTORY_REGISTRATION =
  'partner-production-rollout-register-history.sql';

const REQUIRED_SQL_EVIDENCE = Object.freeze({
  [EXPECTED_PARTNER_MIGRATIONS[0]]: [
    'ALTER TABLE public.tg_property_knowledge',
    'ADD COLUMN IF NOT EXISTS wifi_notes',
  ],
  [EXPECTED_PARTNER_MIGRATIONS[1]]: [
    'CREATE TABLE public.partner_account_bindings',
    'CREATE TABLE public.partner_communication_sessions',
    'CREATE OR REPLACE FUNCTION public.set_partner_communication_updated_at()',
  ],
  [EXPECTED_PARTNER_MIGRATIONS[2]]: [
    'REFERENCES public.partner_account_bindings(id)',
    'EXECUTE FUNCTION public.set_partner_communication_updated_at()',
  ],
  [EXPECTED_PARTNER_MIGRATIONS[3]]: [
    'ALTER TABLE public.partner_account_bindings',
    'ALTER TABLE public.partner_communication_inbox',
    'CREATE TABLE public.partner_communication_decisions',
  ],
  [EXPECTED_PARTNER_MIGRATIONS[4]]: [
    'ALTER TABLE public.partner_communication_decisions',
    'REFERENCES public.partner_communication_decisions(account_id, id)',
  ],
  [EXPECTED_PARTNER_MIGRATIONS[5]]: [
    'REFERENCES public.partner_account_bindings(account_id, id)',
    'REFERENCES public.partner_booking_bindings(account_id, id)',
  ],
  [EXPECTED_PARTNER_MIGRATIONS[6]]: [
    'ALTER TABLE public.partner_property_bindings',
    'REFERENCES public.partner_property_bindings(account_id, partner_account_binding_id, id)',
  ],
});

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function git(args) {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export function validatePartnerProductionRollout({
  expectedSha,
  requireMainAncestor = false,
} = {}) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  invariant(
    manifest.schemaVersion === 'asi.partner-production-rollout.v1',
    'Unexpected rollout manifest schema version.',
  );
  invariant(
    /^[0-9a-f]{40}$/u.test(manifest.canonicalBaseSha),
    'Manifest canonical base must be a full lowercase SHA.',
  );

  const migrations = manifest.migrations ?? [];
  invariant(migrations.length === 7, `Expected exactly 7 migrations, found ${migrations.length}.`);
  invariant(
    JSON.stringify(migrations.map(({ filename }) => filename)) ===
      JSON.stringify(EXPECTED_PARTNER_MIGRATIONS),
    'Authorized migration list or order changed.',
  );
  invariant(
    migrations.every(({ sequence }, index) => sequence === index + 1),
    'Migration sequence must be exactly 1 through 7.',
  );

  const versions = migrations.map(({ version }) => version);
  invariant(new Set(versions).size === versions.length, 'Migration versions must be unique.');
  for (const [index, migration] of migrations.entries()) {
    invariant(
      migration.filename.startsWith(`${migration.version}_`),
      `Version/filename mismatch at sequence ${index + 1}.`,
    );
    const earlierVersions = new Set(versions.slice(0, index));
    for (const dependency of migration.dependsOn ?? []) {
      if (/^\d+$/u.test(dependency)) {
        invariant(
          earlierVersions.has(dependency),
          `${migration.filename} depends on migration ${dependency}, which is not earlier.`,
        );
      }
    }
  }

  const migrationsDirectory = path.join(repoRoot, 'supabase', 'migrations');
  const repositoryPartnerMigrations = readdirSync(migrationsDirectory)
    .filter((filename) => /^\d+_partner_.*\.sql$/u.test(filename))
    .sort((left, right) => left.localeCompare(right));
  const authorizedSorted = [...EXPECTED_PARTNER_MIGRATIONS]
    .sort((left, right) => left.localeCompare(right));
  invariant(
    JSON.stringify(repositoryPartnerMigrations) === JSON.stringify(authorizedSorted),
    `Partner migration inventory differs from the seven-file allowlist: ${repositoryPartnerMigrations.join(', ')}`,
  );

  const verified = migrations.map((migration) => {
    const filePath = path.join(migrationsDirectory, migration.filename);
    const actualSha256 = sha256(filePath);
    invariant(
      actualSha256 === migration.sha256,
      `${migration.filename} checksum mismatch.`,
    );
    const sql = readFileSync(filePath, 'utf8');
    for (const fragment of REQUIRED_SQL_EVIDENCE[migration.filename] ?? []) {
      invariant(sql.includes(fragment), `${migration.filename} is missing dependency evidence: ${fragment}`);
    }
    invariant(
      !/\bCREATE\s+INDEX\s+CONCURRENTLY\b|\bVACUUM\b/iu.test(sql),
      `${migration.filename} is incompatible with the atomic rollout transaction.`,
    );
    return {
      sequence: migration.sequence,
      version: migration.version,
      filename: migration.filename,
      sha256: actualSha256,
    };
  });

  const historyRegistration = manifest.historyRegistration ?? {};
  invariant(
    historyRegistration.filename === EXPECTED_HISTORY_REGISTRATION,
    'Unexpected migration-history registration filename.',
  );
  invariant(
    /^[0-9a-f]{64}$/u.test(historyRegistration.sha256 ?? ''),
    'Migration-history registration checksum must be pinned.',
  );
  const historyRegistrationPath = path.join(
    repoRoot,
    'scripts',
    historyRegistration.filename,
  );
  const historyRegistrationSha256 = sha256(historyRegistrationPath);
  invariant(
    historyRegistrationSha256 === historyRegistration.sha256,
    'Migration-history registration checksum mismatch.',
  );
  const historySql = readFileSync(historyRegistrationPath, 'utf8');
  const registeredRows = [...historySql.matchAll(
    /\('(\d{14})',\s*'([^']+)',\s*ARRAY\[\]::TEXT\[\]\)/gu,
  )].map((match) => ({ version: match[1], name: match[2] }));
  const expectedRows = migrations.map(({ version, filename }) => ({
    version,
    name: filename.replace(/^\d+_|\.sql$/gu, ''),
  }));
  invariant(
    JSON.stringify(registeredRows) === JSON.stringify(expectedRows),
    'Migration-history registration must contain exactly the seven allowlisted versions and names.',
  );
  invariant(
    !/\b(?:ON\s+CONFLICT|UPDATE|DELETE|TRUNCATE)\b/iu.test(historySql),
    'Migration-history registration must use fail-closed plain inserts only.',
  );

  const headSha = git(['rev-parse', 'HEAD']);
  if (expectedSha !== undefined) {
    invariant(/^[0-9a-f]{40}$/u.test(expectedSha), 'Expected rollout SHA must be 40 lowercase hex characters.');
    invariant(headSha === expectedSha, `Checked out SHA ${headSha} does not equal requested SHA ${expectedSha}.`);
  }
  if (requireMainAncestor) {
    try {
      git(['merge-base', '--is-ancestor', headSha, 'origin/main']);
    } catch {
      throw new Error(`Rollout SHA ${headSha} is not an ancestor of origin/main.`);
    }
  }

  return {
    schemaVersion: manifest.schemaVersion,
    canonicalBaseSha: manifest.canonicalBaseSha,
    rolloutSha: headSha,
    migrationCount: verified.length,
    migrations: verified,
    historyRegistration: {
      filename: historyRegistration.filename,
      sha256: historyRegistrationSha256,
      registeredVersions: registeredRows.map(({ version }) => version),
    },
    repositoryPartnerMigrationCount: repositoryPartnerMigrations.length,
    mutationAllowed: false,
    productionTouched: false,
    stagingTouched: false,
    secretsAccessed: false,
  };
}

function main() {
  invariant(process.argv[2] === 'preflight', 'Only the non-mutating "preflight" command is supported.');
  const report = validatePartnerProductionRollout({
    expectedSha: argument('--expected-sha'),
    requireMainAncestor: process.argv.includes('--require-main-ancestor'),
  });
  const reportPath = argument('--report');
  if (reportPath) writeFileSync(path.resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`partner_rollout_preflight_failed=${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
