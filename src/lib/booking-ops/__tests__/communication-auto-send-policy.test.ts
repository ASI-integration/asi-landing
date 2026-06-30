import { describe, expect, it } from 'vitest';
import {
  canAutoSendCommunicationIntent,
  classifyMessageForAutoSend,
  type CommunicationAutoSendPolicy,
} from '../communication-auto-send-policy';
import type { BookingOpsCommunicationIntent } from '../types';

const allowedPolicy: CommunicationAutoSendPolicy = {
  scope: 'global',
  scopeRef: null,
  messageType: 'guest_data_missing_notice',
  channel: 'any',
  autoSendEnabled: true,
  requiresReview: false,
  quietHoursEnabled: false,
  quietHoursStart: null,
  quietHoursEnd: null,
  maxAutoSendsPerBookingPerDay: 3,
  maxAutoSendsPerGuestPerDay: 3,
  allowedRecipientRoles: ['guest'],
  blockedKeywords: [],
  requiredMetadata: [],
};

function intent(overrides: Partial<BookingOpsCommunicationIntent> = {}): BookingOpsCommunicationIntent {
  return {
    id: 'communication-1',
    bookingOpsRecordId: 'booking-ops-1',
    bookingId: 'booking-1',
    relatedTaskId: null,
    actorType: 'guest',
    actorLabel: 'Гость',
    purpose: 'guest_data_missing_notice',
    channel: 'telegram',
    status: 'draft_ready',
    messageText: 'Здравствуйте. Подскажите, пожалуйста, время прибытия.',
    messageTemplateKey: 'guest.arrival.v1',
    metadata: {},
    createdAt: '2026-06-30T10:00:00.000Z',
    updatedAt: '2026-06-30T10:00:00.000Z',
    supersededAt: null,
    ...overrides,
  };
}

describe('communication auto-send guardrails', () => {
  it('allows a configured safe message type', async () => {
    const result = await canAutoSendCommunicationIntent(intent(), {
      policy: allowedPolicy,
      bookingAutoSendsToday: 0,
      guestAutoSendsToday: 0,
    });
    expect(result).toMatchObject({ decision: 'allowed', allowed: true, rule_key: 'policy.allowed' });
  });

  it('requires review for an unknown message type', () => {
    const result = classifyMessageForAutoSend(intent({ purpose: 'unknown_type' as never }));
    expect(result).toMatchObject({ decision: 'unknown_message_type', allowed: false });
  });

  it('blocks a raw access code', () => {
    const result = classifyMessageForAutoSend(intent({ messageText: 'Код от двери: 4829' }));
    expect(result).toMatchObject({ decision: 'unsafe_content', rule_key: 'content.raw_access_code' });
  });

  it('blocks a full document number', () => {
    const result = classifyMessageForAutoSend(intent({ messageText: 'Паспорт 4510 123456 получен' }));
    expect(result).toMatchObject({ decision: 'unsafe_content', rule_key: 'content.document_number' });
  });

  it.each([
    'request_contract_confirmation',
    'request_deposit_payment',
    'request_mvd_data',
  ] as const)('requires review for %s', (purpose) => {
    const result = classifyMessageForAutoSend(intent({ purpose }));
    expect(result).toMatchObject({ decision: 'review_required', rule_key: 'message_type.sensitive_flow' });
  });

  it('allows an urgent worker task during quiet hours when policy explicitly permits it', async () => {
    const workerPolicy: CommunicationAutoSendPolicy = {
      ...allowedPolicy,
      messageType: 'maintenance_request',
      allowedRecipientRoles: ['master'],
      quietHoursEnabled: true,
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
    };
    const result = await canAutoSendCommunicationIntent(intent({
      actorType: 'master',
      purpose: 'maintenance_request',
      metadata: { urgent: true },
    }), {
      policy: workerPolicy,
      now: new Date(2026, 5, 30, 23, 0),
      emergencyAllowedDuringQuietHours: true,
      bookingAutoSendsToday: 0,
      guestAutoSendsToday: 0,
    });
    expect(result.decision).toBe('allowed');
  });

  it('blocks guest auto-send while a complaint or fallback is unresolved', async () => {
    const result = await canAutoSendCommunicationIntent(intent(), {
      policy: allowedPolicy,
      unresolvedComplaint: true,
    });
    expect(result).toMatchObject({ decision: 'blocked', rule_key: 'guest.unresolved_complaint' });
  });

  it('defers a safe message during quiet hours', async () => {
    const result = await canAutoSendCommunicationIntent(intent(), {
      policy: {
        ...allowedPolicy,
        quietHoursEnabled: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '08:00',
      },
      now: new Date(2026, 5, 30, 23, 0),
    });
    expect(result).toMatchObject({ decision: 'quiet_hours', allowed: false });
  });

  it('rate limits per booking', async () => {
    const result = await canAutoSendCommunicationIntent(intent(), {
      policy: allowedPolicy,
      bookingAutoSendsToday: 3,
    });
    expect(result).toMatchObject({ decision: 'rate_limited', rule_key: 'rate.booking_daily' });
  });

  it('never includes a detected secret in the decision explanation', async () => {
    const result = await canAutoSendCommunicationIntent(
      intent({ messageText: 'Код от двери: 4829' }),
      { policy: allowedPolicy },
    );
    expect(JSON.stringify(result)).not.toContain('4829');
  });
});
