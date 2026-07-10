import { describe, expect, it } from 'vitest';
import type { InStayCheckoutSnapshot } from '@/lib/booking-ops/instay-checkout-autopilot';
import type { BookingOpsRecord } from '@/lib/booking-ops/types';
import type { CrmContact } from '../types';
import {
  buildCrmBookingSignals,
  deriveCrmBookingSignalForRecord,
  isBookingClosedForCrmSignals,
  linkBookingRecordToCrmContact,
  sortCrmBookingSignals,
} from '../booking-signals';

const baseRecord: BookingOpsRecord = {
  id: 'ops-1',
  bookingId: 'booking-42',
  guestName: 'Иван Петров',
  guestPhone: '+79990000001',
  guestEmail: null,
  guestTelegram: null,
  propertyId: 'OBJ-1',
  propertyLabel: 'Апартаменты',
  otaSource: 'avito',
  checkInAt: '2026-08-01T14:00:00.000Z',
  checkOutAt: '2026-08-03T11:00:00.000Z',
  opsStatus: 'created',
  manualNextAction: null,
  isBlocked: false,
  blockerReason: null,
  documentsStatus: 'not_started',
  contractStatus: 'not_started',
  depositStatus: 'not_started',
  mvdStatus: 'not_required',
  checkinReadinessStatus: 'not_started',
  unitReadinessStatus: 'not_ready',
  notes: null,
  createdAt: '2026-07-10T08:00:00.000Z',
  updatedAt: '2026-07-10T08:00:00.000Z',
};

const ownerContact: CrmContact = {
  id: 'c-owner',
  name: 'Ольга Владелец',
  phone: '+7 999 000-00-01',
  telegramUsername: 'olga_owner',
  email: 'owner@example.com',
  role: 'owner',
  source: 'telegram',
  objectsCount: 1,
  city: 'Сочи',
  note: '',
  status: 'contact',
  communicationStatus: 'waiting_reply',
  lastContactAt: '2026-07-10T08:00:00.000Z',
  nextStep: '',
  nextActionAt: null,
  createdAt: '2026-07-01T08:00:00.000Z',
  updatedAt: '2026-07-10T08:00:00.000Z',
};

function closedInstay(): InStayCheckoutSnapshot {
  return {
    bookingId: 'ops-1',
    status: 'closed',
    execution: null,
    checkoutInstructionsStatus: 'sent',
    checkoutConfirmationStatus: 'confirmed',
    inspectionStatus: 'done',
    depositReturnStatus: 'returned',
    closureStatus: 'closed',
    openIssuesCount: 0,
    openIssues: [],
    lifecycle: null,
    blockers: [],
    communications: [],
    nextAction: null,
    updatedAt: '2026-07-10T10:00:00.000Z',
  };
}

describe('crm booking signals', () => {
  it('maps incomplete documents to a CRM signal', () => {
    const signal = deriveCrmBookingSignalForRecord(
      {
        ...baseRecord,
        documentsStatus: 'requested',
      },
      { evaluatedAt: '2026-07-10T09:00:00.000Z' },
    );

    expect(signal?.kind).toBe('documents_incomplete');
    expect(signal?.title).toContain('Документы');
  });

  it('creates a CRM signal for incomplete deposit', () => {
    const signal = deriveCrmBookingSignalForRecord(
      {
        ...baseRecord,
        documentsStatus: 'verified',
        contractStatus: 'signed',
        depositStatus: 'requested',
      },
      { evaluatedAt: '2026-07-10T09:00:00.000Z' },
    );

    expect(signal?.kind).toBe('deposit_incomplete');
    expect(signal?.nextAction).toContain('депозит');
  });

  it('creates a CRM signal for missing guest data and intake review', () => {
    const missingData = deriveCrmBookingSignalForRecord(
      {
        ...baseRecord,
        guestPhone: null,
        guestEmail: null,
        guestTelegram: null,
        documentsStatus: 'verified',
        contractStatus: 'signed',
        depositStatus: 'confirmed',
        mvdStatus: 'submitted',
        checkinReadinessStatus: 'ready',
        opsStatus: 'ready_for_checkin',
        readiness: {
          status: 'missing_booking_data',
          missingItems: ['количество гостей'],
          canCreateDrafts: false,
          canManualSend: false,
          checklist: [],
          telegramDraftStatus: 'not_ready',
        },
      },
      { evaluatedAt: '2026-07-10T09:00:00.000Z' },
    );
    expect(missingData?.kind).toBe('missing_guest_data');

    const needsReview = deriveCrmBookingSignalForRecord(
      {
        ...baseRecord,
        propertyId: null,
        propertyLabel: null,
        documentsStatus: 'verified',
        contractStatus: 'signed',
        depositStatus: 'confirmed',
        mvdStatus: 'submitted',
        checkinReadinessStatus: 'ready',
        opsStatus: 'ready_for_checkin',
        guestIntake: {
          id: 'gi-1',
          bookingOpsRecordId: 'ops-1',
          bookingId: 'booking-42',
          intakeStatus: 'fallback_required',
          missingFields: ['guest_phone'],
          collectedFields: {},
          validationErrors: [],
          channel: 'web',
          guestContactRef: null,
          lastGuestActivityAt: null,
          fallbackReason: 'guest_cannot_proceed',
          generatedMessage: null,
          publicToken: 'token',
          publicIntakeUrl: null,
          tokenCreatedAt: '2026-07-10T08:00:00.000Z',
          tokenOpenedAt: null,
          createdAt: '2026-07-10T08:00:00.000Z',
          updatedAt: '2026-07-10T08:00:00.000Z',
        },
      },
      { evaluatedAt: '2026-07-10T09:00:00.000Z' },
    );
    expect(needsReview?.kind).toBe('intake_needs_review');
  });

  it('creates CRM signals for readiness blockers', () => {
    const cleaning = deriveCrmBookingSignalForRecord(
      {
        ...baseRecord,
        documentsStatus: 'verified',
        contractStatus: 'signed',
        depositStatus: 'confirmed',
        checkinReadinessStatus: 'ready',
        unitReadinessStatus: 'cleaning_pending',
      },
      { evaluatedAt: '2026-07-10T09:00:00.000Z' },
    );
    expect(cleaning?.kind).toBe('cleaning_required');

    const linen = deriveCrmBookingSignalForRecord(
      {
        ...baseRecord,
        documentsStatus: 'verified',
        contractStatus: 'signed',
        depositStatus: 'confirmed',
        checkinReadinessStatus: 'ready',
        unitReadinessStatus: 'linen_pending',
      },
      { evaluatedAt: '2026-07-10T09:00:00.000Z' },
    );
    expect(linen?.kind).toBe('linen_required');

    const inspection = deriveCrmBookingSignalForRecord(
      {
        ...baseRecord,
        documentsStatus: 'verified',
        contractStatus: 'signed',
        depositStatus: 'confirmed',
        checkinReadinessStatus: 'ready',
        unitReadinessStatus: 'inspection_pending',
      },
      { evaluatedAt: '2026-07-10T09:00:00.000Z' },
    );
    expect(inspection?.kind).toBe('inspection_required');
  });

  it('does not create an active blocker signal for closed bookings', () => {
    const closedRecord: BookingOpsRecord = {
      ...baseRecord,
      readiness: {
        status: 'completed',
        missingItems: [],
        canCreateDrafts: false,
        canManualSend: false,
        checklist: [],
        telegramDraftStatus: 'completed',
      },
      automation: {
        nextAction: 'pause',
        automationState: 'completed',
        needsOperatorAction: false,
        canAutoPerform: false,
        recommendedOpsStatus: null,
        blockers: [],
        reason: 'Завершено',
        evaluatedAt: '2026-07-10T10:00:00.000Z',
      },
    };

    expect(isBookingClosedForCrmSignals(closedRecord, closedInstay())).toBe(true);
    expect(
      deriveCrmBookingSignalForRecord(closedRecord, {
        instay: closedInstay(),
        evaluatedAt: '2026-07-10T10:00:00.000Z',
      }),
    ).toBeNull();
  });

  it('still surfaces unlinked booking signals', () => {
    const signal = deriveCrmBookingSignalForRecord(
      {
        ...baseRecord,
        guestPhone: '+79991112233',
        documentsStatus: 'requested',
      },
      { contacts: [ownerContact], evaluatedAt: '2026-07-10T09:00:00.000Z' },
    );

    expect(signal).not.toBeNull();
    expect(signal?.linkedContactId).toBeNull();
    expect(signal?.linkedContactName).toBeNull();
    expect(linkBookingRecordToCrmContact(
      { guestPhone: '+79991112233', guestEmail: null, guestTelegram: null },
      [ownerContact],
    ).contactId).toBeNull();
  });

  it('orders signals deterministically by priority', () => {
    const signals = sortCrmBookingSignals([
      {
        id: 'a',
        bookingOpsId: 'ops-a',
        bookingReference: 'A',
        displayName: 'A',
        kind: 'deposit_incomplete',
        severity: 'warning',
        priority: 4,
        title: 'Депозит',
        reason: 'r',
        nextAction: 'n',
        bookingOpsHref: '/dashboard/booking-ops',
        linkedContactId: null,
        linkedContactName: null,
        propertyLabel: null,
        checkInAt: '2026-08-10T12:00:00.000Z',
        checkOutAt: null,
        updatedAt: '2026-07-10T08:00:00.000Z',
      },
      {
        id: 'b',
        bookingOpsId: 'ops-b',
        bookingReference: 'B',
        displayName: 'B',
        kind: 'incident_blocker',
        severity: 'critical',
        priority: 1,
        title: 'Инцидент',
        reason: 'r',
        nextAction: 'n',
        bookingOpsHref: '/dashboard/booking-ops',
        linkedContactId: null,
        linkedContactName: null,
        propertyLabel: null,
        checkInAt: '2026-08-01T12:00:00.000Z',
        checkOutAt: null,
        updatedAt: '2026-07-10T08:00:00.000Z',
      },
      {
        id: 'c',
        bookingOpsId: 'ops-c',
        bookingReference: 'C',
        displayName: 'C',
        kind: 'checkin_blocked',
        severity: 'critical',
        priority: 2,
        title: 'Заезд',
        reason: 'r',
        nextAction: 'n',
        bookingOpsHref: '/dashboard/booking-ops',
        linkedContactId: null,
        linkedContactName: null,
        propertyLabel: null,
        checkInAt: '2026-08-05T12:00:00.000Z',
        checkOutAt: null,
        updatedAt: '2026-07-10T08:00:00.000Z',
      },
    ]);

    expect(signals.map((item) => item.id)).toEqual(['b', 'c', 'a']);
  });

  it('builds one signal per active booking record', () => {
    const signals = buildCrmBookingSignals(
      [
        { ...baseRecord, id: 'ops-1', documentsStatus: 'requested' },
        {
          ...baseRecord,
          id: 'ops-2',
          bookingId: 'booking-43',
          documentsStatus: 'verified',
          contractStatus: 'signed',
          depositStatus: 'requested',
        },
      ],
      [ownerContact],
      new Map(),
      '2026-07-10T09:00:00.000Z',
    );

    expect(signals).toHaveLength(2);
    expect(signals.some((item) => item.kind === 'documents_incomplete')).toBe(true);
    expect(signals.some((item) => item.kind === 'deposit_incomplete')).toBe(true);
  });
});
