import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PUBLIC_SQL = 'supabase/migrations/20260912210000_asi_runtime_bridge_single_lane_admission_v1.sql';
const STAGING_SQL = 'supabase/staging/20260912210000_runtime_bridge_single_lane_admission_v1.sql';
const SP10 = 'docs/operations/strigunov-pilot-sp10-staging-acceptance.md';
const STAGING_README = 'supabase/staging/README.md';
const PREFLIGHT_ERROR = 'asi_runtime_bridge_single_lane_preflight_failed';

const PUBLIC_QUERY = [
  'SELECT count(*)',
  'FROM public.asi_runtime_bridge_tasks',
  "WHERE status IN ('queued', 'running', 'awaiting_owner');",
].join('\n');

const STAGING_QUERY = [
  'SELECT count(*)',
  'FROM runtime_bridge.asi_runtime_bridge_tasks',
  "WHERE status IN ('queued', 'running', 'awaiting_owner');",
].join('\n');

function assertOperatorQueryDocumented(source: string, schema: 'public' | 'runtime_bridge') {
  expect(source).toContain('SELECT count(*)');
  expect(source).toContain(`FROM ${schema}.asi_runtime_bridge_tasks`);
  expect(source).toContain("WHERE status IN ('queued', 'running', 'awaiting_owner')");
}

function readText(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function assertPreflightBeforeIndex(sql: string, schema: 'public' | 'runtime_bridge') {
  const preflight = sql.indexOf(PREFLIGHT_ERROR);
  const index = sql.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS idx_asi_runtime_bridge_single_nonterminal');
  expect(preflight).toBeGreaterThan(-1);
  expect(index).toBeGreaterThan(preflight);
  expect(sql).toContain(`FROM ${schema}.asi_runtime_bridge_tasks`);
  expect(sql).toContain("WHERE status IN ('queued', 'running', 'awaiting_owner')");
  expect(sql).toContain('v_nonterminal_count > 1');
  expect(sql).toMatch(/Do not auto-reconcile/i);
  const preflightBlock = sql.slice(sql.indexOf('DO $$'), index);
  expect(preflightBlock).not.toMatch(/\bDELETE\b/i);
  expect(preflightBlock).not.toMatch(/\bUPDATE\b/i);
  expect(preflightBlock).not.toMatch(/\bTRUNCATE\b/i);
  expect(preflightBlock).not.toMatch(/\bCANCEL\b/i);
}

describe('Bridge single-lane admission migration preflight (static)', () => {
  it('public migration fail-closes before creating the unique index', () => {
    const sql = readText(PUBLIC_SQL);
    expect(sql).toContain(PUBLIC_QUERY);
    assertOperatorQueryDocumented(sql, 'public');
    assertPreflightBeforeIndex(sql, 'public');
    expect(sql).not.toMatch(/CREATE TABLE public\.asi_runtime_bridge_tasks/);
  });

  it('runtime_bridge staging follow-up fail-closes before creating the unique index', () => {
    const sql = readText(STAGING_SQL);
    expect(sql).toContain(STAGING_QUERY);
    assertOperatorQueryDocumented(sql, 'runtime_bridge');
    assertPreflightBeforeIndex(sql, 'runtime_bridge');
    expect(sql).not.toMatch(/\bpublic\./);
  });

  it('SP-10 runbook records the operator query and blocks apply when count > 1', () => {
    const runbook = readText(SP10);
    const stagingReadme = readText(STAGING_README);
    expect(runbook).toContain(PUBLIC_QUERY);
    expect(runbook).toContain(STAGING_QUERY);
    expect(runbook).toContain(PREFLIGHT_ERROR);
    expect(runbook).toMatch(/0  → safe to apply|0 \| Safe to apply/i);
    expect(runbook).toMatch(/>1 \| \*\*STOP\.\*\*/);
    expect(runbook).toMatch(/Do not start the sequence below if the[\s\S]+preflight count is >1 or unrecorded/);
    expect(stagingReadme).toContain(STAGING_QUERY);
    expect(stagingReadme).toContain(PREFLIGHT_ERROR);
    expect(stagingReadme).toMatch(/\*\*STOP\*\*/);
  });
});
