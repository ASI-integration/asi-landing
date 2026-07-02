import { describe, expect, it } from 'vitest';
import {
  classifyAvailabilityConflicts,
  isConfirmationLikeCommunication,
  normalizeAvailabilityDate,
  rangesOverlap,
  type AvailabilityConflict,
} from '../availability-overbooking-protection';

const conflict = (type: AvailabilityConflict['type'], severity: AvailabilityConflict['severity']): AvailabilityConflict => ({ type, severity, id: `${type}-1` });

describe('Availability & Overbooking Protection v1', () => {
  it('returns no conflict for an empty calendar', () => expect(classifyAvailabilityConflicts([])).toBe('no_conflict'));
  it('detects an overlapping confirmed booking', () => {
    expect(rangesOverlap('2026-07-10', '2026-07-15', '2026-07-12', '2026-07-14')).toBe(true);
    expect(classifyAvailabilityConflicts([conflict('booking', 'confirmed')])).toBe('confirmed_conflict');
  });
  it('allows adjacent checkout and check-in', () => expect(rangesOverlap('2026-07-10', '2026-07-12', '2026-07-12', '2026-07-15')).toBe(false));
  it('classifies an active hold as possible conflict', () => expect(classifyAvailabilityConflicts([conflict('active_hold', 'possible')])).toBe('possible_conflict'));
  it('does not add released or expired holds when candidate list is empty', () => expect(classifyAvailabilityConflicts([])).toBe('no_conflict'));
  it('classifies a manual block as confirmed conflict', () => expect(classifyAvailabilityConflicts([conflict('manual_block', 'confirmed')])).toBe('confirmed_conflict'));
  it('classifies an imported booking as confirmed conflict', () => expect(classifyAvailabilityConflicts([conflict('channel_booking', 'confirmed')])).toBe('confirmed_conflict'));
  it('uses half-open nights for a contained range', () => expect(rangesOverlap('2026-07-10', '2026-07-20', '2026-07-11', '2026-07-12')).toBe(true));
  it('rejects invalid calendar dates', () => expect(normalizeAvailabilityDate('2026-02-30')).toBeNull());
  it('normalizes timestamps to a date', () => expect(normalizeAvailabilityDate('2026-07-10T13:00:00Z')).toBe('2026-07-10'));
  it('blocks check-in instructions as confirmation-like', () => expect(isConfirmationLikeCommunication({ purpose: 'send_checkin_instructions', messageText: 'Инструкции готовы.' })).toBe(true));
  it('blocks text that guarantees confirmed dates', () => expect(isConfirmationLikeCommunication({ purpose: 'issue_followup', messageText: 'Ваша бронь подтверждена, даты гарантированы.' })).toBe(true));
  it('allows neutral request acknowledgement', () => expect(isConfirmationLikeCommunication({ purpose: 'neutral_booking_acknowledgement', messageText: 'Мы получили вашу заявку.' })).toBe(false));
  it('allows checking availability message', () => expect(isConfirmationLikeCommunication({ purpose: 'neutral_status_update', messageText: 'Проверяем доступность, пожалуйста, подождите.' })).toBe(false));
  it('gives hard conflicts priority over active holds', () => expect(classifyAvailabilityConflicts([conflict('active_hold', 'possible'), conflict('booking', 'confirmed')])).toBe('confirmed_conflict'));
});
