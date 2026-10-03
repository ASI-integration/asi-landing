import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/dashboard/booking-ops/access.ts'),
  'utf8',
);

describe('Booking Ops availability access contract', () => {
  it('routes availability scope through shared canonical booking/property access', () => {
    expect(source).toContain('requireBookingOpsApiAvailabilityScopeAccess');
    expect(source).toContain('requireBookingOpsRouteAccess(session, bookingId)');
    expect(source).toContain('requireBookingOpsPropertyAccess(session, propertyId)');
    expect(source).toContain("throw new Error('property_scope_mismatch')");
  });

  it('revalidates conflict checks against canonical account lineage', () => {
    expect(source).toContain('requireBookingOpsApiAvailabilityCheckAccess');
    expect(source).toContain(".from('booking_overbooking_conflict_checks')");
    expect(source).toContain('storedAccountId !== account.accountId');
  });
});
