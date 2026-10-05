import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../channel-manager-reconciliation.ts', import.meta.url),
  'utf8',
);

describe('channel manager reconciliation cleanup scope contract', () => {
  it('keeps stale-running cleanup bound to the original connection', () => {
    const start = source.indexOf("case 'stale_running_sync'");
    const end = source.indexOf("case 'lease_run_mismatch'", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(source.slice(start, end)).toContain(
      ".eq('id', runId).eq('connection_id', connection.id).eq('status', 'running')",
    );
  });

  it('keeps stale-after-guard abort bound to the original connection', () => {
    const start = source.indexOf('async function abortReconciliationImportRunKeepPreview');
    const end = source.indexOf('async function assertReportStillFresh', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(source.slice(start, end)).toContain(
      ".eq('id', input.importRunId).eq('connection_id', input.connectionId).eq('status', 'running')",
    );
  });
});
