import { describe, expect, it } from 'vitest';
import {
  isPilotAcceptanceBooking,
  isPilotAcceptanceProperty,
  looksLikeTechnicalPropertyId,
  matchesTestOrAcceptanceMarker,
} from '@/lib/pilot-data/test-markers';

describe('pilot test markers', () => {
  it('detects acceptance markers', () => {
    expect(matchesTestOrAcceptanceMarker('ASI_PILOT_READINESS_ACCEPTANCE_abc')).toBe(true);
    expect(matchesTestOrAcceptanceMarker('ASI_TG_OPS_ACCEPTANCE_run')).toBe(true);
    expect(matchesTestOrAcceptanceMarker('обычная бронь')).toBe(false);
  });

  it('flags pilot acceptance property ids', () => {
    expect(isPilotAcceptanceProperty({ propertyId: 'pilot_accept_123' })).toBe(true);
    expect(isPilotAcceptanceProperty({ propertyId: 'lit_12' })).toBe(false);
  });

  it('flags pilot acceptance bookings', () => {
    expect(
      isPilotAcceptanceBooking({
        reservationRef: 'ASI_PILOT_READINESS_ACCEPTANCE_booking',
      }),
    ).toBe(true);
  });

  it('detects technical property ids', () => {
    expect(looksLikeTechnicalPropertyId('pilot_spb_test_ab12cd')).toBe(true);
    expect(looksLikeTechnicalPropertyId('Литейный 12')).toBe(false);
  });
});
