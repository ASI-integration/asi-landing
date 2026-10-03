import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/lib/reservations/ledger.ts'),
  'utf8',
);

describe('canonical reservation ledger account scope', () => {
  it('scopes intake identity and canonical creation to the supplied account', () => {
    expect(source).toContain(".from('booking_inbound_intake_events').select('booking_id,status').eq('account_id', input.accountId)");
    expect(source).toContain("}, 'admin', { inputTrust: 'authenticated_internal', accountId: input.accountId });");
  });

  it('revalidates reused booking identities and scopes post-intake mutations', () => {
    expect(source).toContain(".eq('id', existingEvent.data.booking_id).eq('account_id', input.accountId)");
    expect(source).toContain(".eq('id', linked.data.booking_ops_record_id).eq('account_id', input.accountId)");
    expect(source).toContain(".eq('id', intake.bookingId).eq('account_id', input.accountId)");
    expect(source).toContain(".eq('id', atomicHoldId).eq('account_id', input.accountId)");
  });
});
