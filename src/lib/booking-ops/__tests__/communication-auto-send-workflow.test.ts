import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/booking-ops-auto-send.yml'),
  'utf8',
);

describe('Booking Ops safe auto-send workflow', () => {
  it('requires an explicit canonical account scope for manual runs', () => {
    expect(workflow).toContain('account_id:');
    expect(workflow).toContain('description: Canonical account UUID to process');
    expect(workflow).toContain('required: true');
    expect(workflow).toContain('MANUAL_ACCOUNT_ID: ${{ inputs.account_id }}');
    expect(workflow).toContain('Invalid canonical account UUID');
  });

  it('sends accountId, dryRun and bounded batch size to the protected runner', () => {
    expect(workflow).toContain('MANUAL_MAX_BATCH_SIZE: ${{ inputs.max_batch_size }}');
    expect(workflow).toContain('max_batch_size must be between 1 and 20');
    expect(workflow).toContain('maxBatchSize:Number(process.argv[3])');
    expect(workflow).toContain('/api/internal/booking-ops/communications/auto-send/run');
  });

  it('keeps scheduled account discovery scoped and bounded', () => {
    expect(workflow).toContain('/api/internal/booking-ops/communications/auto-send/accounts');
    expect(workflow).toContain('run_account "$account_id" "false" "10"');
    expect(workflow).not.toContain("BODY='{}'");
  });
});
