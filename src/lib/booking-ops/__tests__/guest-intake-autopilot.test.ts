import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildBookingOpsPatchFromGuestSubmission,
  evaluateGuestIntakeState,
} from '../guest-intake-state';
import { planBookingOpsCommunications } from '../communication-orchestrator';
import type { BookingOpsRecord } from '../types';

function booking(overrides: Partial<BookingOpsRecord> = {}): BookingOpsRecord {
  return {
    id: 'ops-guest-intake-v1',
    bookingId: 'reservation-guest-intake-v1',
    guestName: 'Анна Смирнова',
    guestPhone: '+79990000002',
    guestEmail: null,
    guestTelegram: '@guest',
    propertyId: 'OBJ-2',
    propertyLabel: 'Студия у метро',
    otaSource: 'avito',
    checkInAt: '2026-08-01T14:00:00.000Z',
    checkOutAt: '2026-08-03T11:00:00.000Z',
    opsStatus: 'created',
    manualNextAction: null,
    isBlocked: false,
    blockerReason: null,
    documentsStatus: 'verified',
    contractStatus: 'signed',
    depositStatus: 'confirmed',
    mvdStatus: 'not_required',
    checkinReadinessStatus: 'in_progress',
    unitReadinessStatus: 'not_ready',
    notes: null,
    guestCount: 1,
    paymentStatus: 'paid',
    documentRequired: true,
    documentCollected: true,
    documentVerificationStatus: 'verified',
    documentNotes: null,
    contractRequired: true,
    contractProvider: 'manual',
    contractIntakeStatus: 'signed',
    contractLink: 'https://example.com/contract',
    contractNotes: null,
    depositRequired: true,
    depositAmount: 5000,
    depositIntakeStatus: 'received',
    depositPaymentMethod: 'card',
    depositNotes: null,
    mvdRequired: false,
    mvdDataStatus: 'not_required',
    mvdConfirmationLink: null,
    mvdNotes: null,
    createdAt: '2026-06-29T08:00:00.000Z',
    updatedAt: '2026-06-29T08:00:00.000Z',
    ...overrides,
  };
}

describe('Booking Ops Guest Intake Autopilot v1', () => {
  it('creates waiting intake state for missing documents', () => {
    const state = evaluateGuestIntakeState({
      record: booking({
        documentsStatus: 'requested',
        documentCollected: false,
        documentVerificationStatus: 'missing',
      }),
    });
    expect(state.intakeStatus).toBe('waiting_for_guest');
    expect(state.missingFields).toContain('documents');
    expect(state.generatedMessage).toContain('Документы');
  });

  it('creates a deposit intake need when deposit is missing', () => {
    const state = evaluateGuestIntakeState({
      record: booking({ depositStatus: 'requested', depositIntakeStatus: 'requested' }),
    });
    expect(state.missingFields).toContain('deposit_confirmation');
  });

  it('creates an MVD intake need when MVD data is required and missing', () => {
    const state = evaluateGuestIntakeState({
      record: booking({ mvdRequired: true, mvdStatus: 'required', mvdDataStatus: 'missing' }),
    });
    expect(state.missingFields).toContain('mvd_data');
  });

  it('marks complete when required guest data is present', () => {
    const state = evaluateGuestIntakeState({ record: booking() });
    expect(state.intakeStatus).toBe('completed');
    expect(state.missingFields).toHaveLength(0);
  });

  it('complete guest submission produces readiness-advancing patch fields', () => {
    const result = buildBookingOpsPatchFromGuestSubmission({
      phone: '+79990000003',
      documentAttachmentRefs: ['doc-ref-1'],
      contractConfirmed: true,
      depositConfirmed: true,
      mvdDataPresent: true,
    });
    expect(result.validationErrors).toHaveLength(0);
    expect(result.patch).toMatchObject({
      guestPhone: '+79990000003',
      documentCollected: true,
      documentVerificationStatus: 'uploaded',
      contractIntakeStatus: 'signed',
      depositIntakeStatus: 'received',
      mvdDataStatus: 'collected',
    });
  });

  it('invalid or missing attachments require validation without storing raw document values', () => {
    const result = buildBookingOpsPatchFromGuestSubmission({ documentAttachmentRefs: [] });
    expect(result.validationErrors).toContain('Проверить документы вручную');
    expect(JSON.stringify(result.patch)).not.toContain('passport');
  });

  it('inactive intake becomes explicit manual fallback', () => {
    const state = evaluateGuestIntakeState({
      record: booking({
        documentsStatus: 'requested',
        documentCollected: false,
        documentVerificationStatus: 'missing',
      }),
      existingSession: {
        id: 'guest-intake-existing',
        bookingOpsRecordId: 'ops-guest-intake-v1',
        bookingId: 'reservation-guest-intake-v1',
        intakeStatus: 'waiting_for_guest',
        missingFields: ['documents'],
        collectedFields: {},
        validationErrors: [],
        channel: 'telegram',
        guestContactRef: '@guest',
        lastGuestActivityAt: '2026-06-25T08:00:00.000Z',
        fallbackReason: null,
        generatedMessage: null,
        createdAt: '2026-06-25T08:00:00.000Z',
        updatedAt: '2026-06-25T08:00:00.000Z',
      },
      now: new Date('2026-06-29T09:00:00.000Z'),
    });
    expect(state.intakeStatus).toBe('fallback_required');
    expect(state.fallbackReason).toBe('Гость не завершил ввод данных');
  });

  it('fallback integrates with communication intents without duplicate active intents', () => {
    const record = booking({
      guestIntake: {
        id: 'guest-intake-fallback',
        bookingOpsRecordId: 'ops-guest-intake-v1',
        bookingId: 'reservation-guest-intake-v1',
        intakeStatus: 'fallback_required',
        missingFields: ['documents'],
        collectedFields: {},
        validationErrors: [],
        channel: 'telegram',
        guestContactRef: '@guest',
        lastGuestActivityAt: null,
        fallbackReason: 'Требуется ручная помощь гостю',
        generatedMessage: null,
        createdAt: '2026-06-29T08:00:00.000Z',
        updatedAt: '2026-06-29T08:00:00.000Z',
      },
    });
    const first = planBookingOpsCommunications({ record, tasks: [] });
    const second = planBookingOpsCommunications({
      record,
      tasks: [],
      existingCommunications: [{
        id: 'comm-existing',
        bookingOpsRecordId: record.id,
        bookingId: record.bookingId,
        relatedTaskId: null,
        actorType: 'admin',
        actorLabel: 'Оператор',
        purpose: 'issue_escalation_notice',
        channel: 'internal',
        status: 'draft_ready',
        messageText: 'Требуется ручная помощь гостю',
        messageTemplateKey: 'operator.guest_intake_fallback.v1',
        metadata: {},
        createdAt: '2026-06-29T08:00:00.000Z',
        updatedAt: '2026-06-29T08:00:00.000Z',
        supersededAt: null,
      }],
    });
    expect(first.desired[0]).toMatchObject({ purpose: 'issue_escalation_notice' });
    expect(second.toCreate).toHaveLength(0);
  });

  it('does not include uncontrolled Telegram or email send calls', () => {
    const stateSource = readFileSync('src/lib/booking-ops/guest-intake-state.ts', 'utf8');
    const autopilotSource = readFileSync('src/lib/booking-ops/guest-intake-autopilot.ts', 'utf8');
    expect(`${stateSource}\n${autopilotSource}`).not.toContain('sendTelegramMessage');
    expect(`${stateSource}\n${autopilotSource}`).not.toContain('api.telegram.org');
    expect(`${stateSource}\n${autopilotSource}`).not.toContain('sendMessage');
  });
});
