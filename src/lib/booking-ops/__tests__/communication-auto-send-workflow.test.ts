import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/booking-ops-auto-send.yml'),
  'utf8',
);

describe('Booking Ops safe auto-send workflow', () => {
  it('requires an explicit canonical account scope', () => {
    expect(workflow).toMatch(/account_id:\s*\n\s*description:[^\n]*\n\s*required: true/);
    expect(workflow).toContain('ACCOUNT_ID: ${{ inputs.account_id }}');
    expect(workflow).toContain('account_id must be a canonical UUID');
  });

  it('sends accountId, dryRun and bounded batch size to the protected runner', () => {
    expect(workflow).toContain('MAX_BATCH_SIZE: ${{ inputs.max_batch_size }}');
    expect(workflow).toContain('max_batch_size must be between 1 and 20');
    expect(workflow).toContain('\\"accountId\\":\\"${ACCOUNT_ID}\\"');
    expect(workflow).toContain('\\"dryRun\\":${MANUAL_DRY_RUN}');
    expect(workflow).toContain('\\"maxBatchSize\\":${MAX_BATCH_SIZE}');
    expect(workflow).toContain('/api/internal/booking-ops/communications/auto-send/run');
  });

  it('does not fall back to the old unscoped empty payload', () => {
    expect(workflow).not.toContain("BODY='{}'");
    expect(workflow).not.toContain('EVENT_NAME:');
  });
});
