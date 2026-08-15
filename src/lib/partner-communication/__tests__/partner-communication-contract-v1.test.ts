import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  PARTNER_COMMUNICATION_EVENT_TYPE,
  PartnerCommunicationContractError,
  isTrustedPartnerCommunicationContext,
  partnerBookingKey,
  partnerEventIdempotencyKey,
  partnerPropertyKey,
  validateTrustedPartnerCommunicationEvent,
} from '../contract';
import {
  SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1,
  runSyntheticPartnerCommunicationContractV1,
} from '../synthetic';

function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return structuredClone({ ...SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1, ...overrides });
}

function expectCode(input: unknown, code: string): void {
  try {
    validateTrustedPartnerCommunicationEvent(input);
    throw new Error('expected partner contract validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(PartnerCommunicationContractError);
    expect((error as PartnerCommunicationContractError).code).toBe(code);
    expect((error as Error).message).toBe(code);
  }
}

describe('Partner Communication Contract v1', () => {
  it('normalizes a valid guest.message.received event into trusted context', () => {
    const context = validateTrustedPartnerCommunicationEvent(event());
    expect(isTrustedPartnerCommunicationContext(context)).toBe(true);
    expect(context).toMatchObject({
      schemaVersion: 'partner.communication.v1',
      eventType: PARTNER_COMMUNICATION_EVENT_TYPE,
      occurredAt: '2026-08-15T12:00:00.000Z',
      identity: {
        partnerId: 'apart-sharing-demo',
        accountId: 'partner-account-1',
        propertyId: 'property-101',
        bookingId: 'booking-5001',
        guestId: 'guest-77',
        conversationId: 'conversation-900',
        messageId: 'message-1',
        eventId: 'synthetic-event-1',
      },
      message: { channel: 'partner_messaging', text: 'Какой пароль от Wi-Fi?' },
    });
  });

  it('creates a deterministic event idempotency identity', () => {
    const first = partnerEventIdempotencyKey('partner-1', 'account-1', 'event-1');
    const second = partnerEventIdempotencyKey('partner-1', 'account-1', 'event-1');
    expect(first).toBe(second);
  });

  it('isolates identical booking IDs by account', () => {
    expect(partnerBookingKey('partner-1', 'account-A', 'booking-1'))
      .not.toBe(partnerBookingKey('partner-1', 'account-B', 'booking-1'));
  });

  it('isolates identical property IDs by account', () => {
    expect(partnerPropertyKey('partner-1', 'account-A', 'property-1'))
      .not.toBe(partnerPropertyKey('partner-1', 'account-B', 'property-1'));
  });

  it('isolates identical event IDs by partner and account', () => {
    const base = partnerEventIdempotencyKey('partner-1', 'account-A', 'event-1');
    expect(base).not.toBe(partnerEventIdempotencyKey('partner-1', 'account-B', 'event-1'));
    expect(base).not.toBe(partnerEventIdempotencyKey('partner-2', 'account-A', 'event-1'));
  });

  it('rejects blank authoritative identity fail-closed', () => {
    expectCode(event({
      partner: { partnerId: 'apart-sharing-demo', accountId: '   ' },
    }), 'partner_identity_invalid');
  });

  it('rejects unsupported schema versions', () => {
    expectCode(event({ schemaVersion: 'partner.communication.v2' }), 'partner_schema_version_unsupported');
  });

  it('rejects unsupported event types', () => {
    expectCode(event({ eventType: 'booking.upsert' }), 'partner_event_type_unsupported');
  });

  it('rejects impossible booking date relationships', () => {
    expectCode(event({
      booking: {
        bookingId: 'booking-5001',
        status: 'confirmed',
        checkInAt: '2026-09-03T12:00:00.000Z',
        checkOutAt: '2026-09-03T12:00:00.000Z',
      },
    }), 'partner_booking_state_invalid');
  });

  it('rejects blank and oversized guest messages', () => {
    expectCode(event({
      conversation: { ...SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1.conversation, text: '   ' },
    }), 'partner_message_invalid');
    expectCode(event({
      conversation: { ...SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1.conversation, text: 'x'.repeat(4_097) },
    }), 'partner_message_invalid');
  });

  it('rejects missing message identity with a stable safe error', () => {
    expectCode(event({
      conversation: { ...SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1.conversation, messageId: '' },
    }), 'partner_message_invalid');
  });

  it('rejects fuzzy and internal authority fields instead of using them', () => {
    for (const forbidden of [
      { phone: '+79990000000' },
      { email: 'guest@example.test' },
      { propertyLabel: 'Some property' },
      { bookingReference: 'booking by name' },
      { internalAccountId: 'asi-account-id' },
    ]) {
      expectCode(event(forbidden), 'partner_contract_invalid');
    }
  });

  it('keeps the contract server-only and absent from the public web route', () => {
    const contractSource = readFileSync(resolve(process.cwd(), 'src/lib/partner-communication/contract.ts'), 'utf8');
    const publicRouteSource = readFileSync(resolve(process.cwd(), 'src/app/api/booking-ops/intake/web/route.ts'), 'utf8');
    expect(contractSource.startsWith("import 'server-only';")).toBe(true);
    expect(publicRouteSource).not.toContain('partner-communication');
    expect(publicRouteSource).not.toContain('PartnerCommunicationContext');
  });

  it('runs the explicitly synthetic fixture without invoking communication delivery', () => {
    const first = runSyntheticPartnerCommunicationContractV1();
    const second = runSyntheticPartnerCommunicationContractV1();
    expect(first.context.keys).toEqual(second.context.keys);
    expect(first.response).toMatchObject({
      schemaVersion: 'partner.communication.response.v1',
      accepted: true,
      duplicate: false,
      auditRef: 'synthetic-partner-contract-v1',
      decision: {
        type: 'no_action',
        text: null,
        confidence: null,
        policy: 'review_required',
        reasonCodes: ['synthetic_contract_only', 'communication_engine_not_invoked'],
      },
      operationalActions: [],
    });
  });
});
