import { describe, expect, it } from 'vitest';
import {
  classifyAvailabilityConflicts,
  collapseChannelCalendarConflicts,
  evaluateSyntheticAvailabilityConflicts,
  rangesOverlap,
  type SyntheticCalendarNight,
  type SyntheticReservationStay,
} from '../availability-overbooking-protection';

const ACCOUNT_A = 'account-a';
const ACCOUNT_B = 'account-b';
const PROPERTY = 'prop-1';
const OTHER_PROPERTY = 'prop-2';

const reservations: SyntheticReservationStay[] = [
  {
    id: 'stay-later',
    accountId: ACCOUNT_A,
    propertyId: PROPERTY,
    dateFrom: '2026-08-10',
    dateTo: '2026-08-14',
  },
  {
    id: 'stay-overlap-reversed',
    accountId: ACCOUNT_A,
    propertyId: PROPERTY,
    dateFrom: '2026-08-09',
    dateTo: '2026-08-04',
  },
  {
    id: 'stay-other-account',
    accountId: ACCOUNT_B,
    propertyId: PROPERTY,
    dateFrom: '2026-08-01',
    dateTo: '2026-08-20',
  },
  {
    id: 'stay-other-property',
    accountId: ACCOUNT_A,
    propertyId: OTHER_PROPERTY,
    dateFrom: '2026-08-01',
    dateTo: '2026-08-20',
  },
  {
    id: 'stay-adjacent',
    accountId: ACCOUNT_A,
    propertyId: PROPERTY,
    dateFrom: '2026-08-08',
    dateTo: '2026-08-10',
  },
];

const requested = { dateFrom: '2026-08-06', dateTo: '2026-08-08' };

describe('G2-G6 synthetic overbooking guard', () => {
  it('uses half-open overlap and classifies a same-property booking conflict', () => {
    expect(rangesOverlap('2026-08-04', '2026-08-09', '2026-08-06', '2026-08-08')).toBe(true);
    expect(rangesOverlap('2026-08-06', '2026-08-08', '2026-08-04', '2026-08-09')).toBe(true);
    expect(rangesOverlap('2026-08-01', '2026-08-06', '2026-08-06', '2026-08-08')).toBe(false);
    expect(classifyAvailabilityConflicts([
      { type: 'booking', id: 'stay-overlap-reversed', severity: 'confirmed' },
    ])).toBe('confirmed_conflict');
    expect(classifyAvailabilityConflicts([])).toBe('no_conflict');
  });

  it('finds the same conflict when synthetic reservations are listed out of order', () => {
    const first = evaluateSyntheticAvailabilityConflicts({
      accountId: ACCOUNT_A,
      propertyId: PROPERTY,
      ...requested,
      reservations,
    });
    const reversed = evaluateSyntheticAvailabilityConflicts({
      accountId: ACCOUNT_A,
      propertyId: PROPERTY,
      ...requested,
      reservations: [...reservations].reverse(),
    });

    expect(first).toEqual(reversed);
    expect(first.status).toBe('confirmed_conflict');
    expect(first.conflicts).toEqual([
      { type: 'booking', id: 'stay-overlap-reversed', severity: 'confirmed' },
    ]);
  });

  it('does not treat another account or another property as a same-property conflict', () => {
    const isolated = evaluateSyntheticAvailabilityConflicts({
      accountId: ACCOUNT_A,
      propertyId: PROPERTY,
      dateFrom: '2026-08-15',
      dateTo: '2026-08-16',
      reservations,
    });
    const wrongAccount = evaluateSyntheticAvailabilityConflicts({
      accountId: ACCOUNT_B,
      propertyId: PROPERTY,
      ...requested,
      reservations,
    });

    expect(isolated).toEqual({ status: 'no_conflict', conflicts: [] });
    expect(wrongAccount.conflicts.map((conflict) => conflict.id)).toEqual(['stay-other-account']);
    expect(wrongAccount.conflicts.some((conflict) => conflict.id === 'stay-overlap-reversed')).toBe(false);
  });

  it('collapses out-of-order calendar nights without letting another account close a gap', () => {
    const nights: SyntheticCalendarNight[] = [
      { id: 'night-08', accountId: ACCOUNT_A, propertyId: PROPERTY, date: '2026-08-08' },
      { id: 'night-foreign', accountId: ACCOUNT_B, propertyId: PROPERTY, date: '2026-08-07' },
      { id: 'night-06', accountId: ACCOUNT_A, propertyId: PROPERTY, date: '2026-08-06' },
      { id: 'night-other-property', accountId: ACCOUNT_A, propertyId: OTHER_PROPERTY, date: '2026-08-07' },
    ];
    expect(collapseChannelCalendarConflicts([
      { id: 'night-08', date: '2026-08-08' },
      { id: 'night-06', date: '2026-08-06' },
      { id: 'night-07', date: '2026-08-07' },
    ])).toEqual([
      { type: 'channel_calendar', id: 'night-06', severity: 'confirmed' },
    ]);

    const gapped = evaluateSyntheticAvailabilityConflicts({
      accountId: ACCOUNT_A,
      propertyId: PROPERTY,
      dateFrom: '2026-08-06',
      dateTo: '2026-08-09',
      reservations: [],
      calendarNights: nights,
    });
    expect(gapped.status).toBe('confirmed_conflict');
    expect(gapped.conflicts).toEqual([
      { type: 'channel_calendar', id: 'night-06', severity: 'confirmed' },
      { type: 'channel_calendar', id: 'night-08', severity: 'confirmed' },
    ]);
  });

  it('returns missing data for an empty stay and does not invent conflicts', () => {
    expect(evaluateSyntheticAvailabilityConflicts({
      accountId: ACCOUNT_A,
      propertyId: PROPERTY,
      dateFrom: '2026-08-08',
      dateTo: '2026-08-08',
      reservations,
    })).toEqual({ status: 'missing_data', conflicts: [] });
  });
});
