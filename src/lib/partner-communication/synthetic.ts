import 'server-only';

import {
  PARTNER_COMMUNICATION_RESPONSE_SCHEMA_VERSION,
  validateTrustedPartnerCommunicationEvent,
  type PartnerCommunicationDecisionEnvelopeV1,
  type PartnerCommunicationContext,
  type PartnerGuestMessageEventV1,
} from './contract';
import { hashPartnerBearerTokenForProvisioning } from './auth';

export const SYNTHETIC_PARTNER_CREDENTIAL = Object.freeze({
  credentialId: 'demo-credential-1',
  token: 'synthetic-test-token-ONLY',
  tokenHash: hashPartnerBearerTokenForProvisioning('synthetic-test-token-ONLY'),
  canonicalAccountId: '10000000-0000-4000-8000-000000000001',
  partnerAccountBindingId: '30000000-0000-4000-8000-000000000003',
});

/** Synthetic demo knowledge only. These values must never be provisioned as real property data. */
export const SYNTHETIC_APART_SHARING_PROPERTY_V1 = Object.freeze({
  name: 'Apartment 101',
  externalPropertyId: 'property-101',
  canonicalPropertyId: '50000000-0000-4000-8000-000000000005',
  externalBookingId: 'booking-5001',
  canonicalBookingId: '60000000-0000-4000-8000-000000000006',
  wifiName: 'ASI-Demo',
  wifiPassword: 'demo-wifi-2026',
});

/** Synthetic fixture only. This is not an Apart Sharing API or integration. */
export const SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1: PartnerGuestMessageEventV1 = {
  schemaVersion: 'partner.communication.v1',
  eventId: 'synthetic-event-1',
  eventType: 'guest.message.received',
  occurredAt: '2026-08-15T12:00:00.000Z',
  partner: {
    partnerId: 'apart-sharing-demo',
    accountId: 'partner-account-1',
  },
  property: {
    propertyId: 'property-101',
  },
  booking: {
    bookingId: 'booking-5001',
    status: 'confirmed',
    checkInAt: null,
    checkOutAt: null,
  },
  guest: {
    guestId: 'guest-77',
    preferredLanguage: 'ru',
  },
  conversation: {
    conversationId: 'conversation-900',
    messageId: 'message-1',
    channel: 'partner_messaging',
    text: 'Какой пароль от Wi-Fi?',
  },
};

export type SyntheticPartnerCommunicationResult = {
  context: PartnerCommunicationContext;
  response: PartnerCommunicationDecisionEnvelopeV1;
};

export function runSyntheticPartnerCommunicationContractV1(
  input: unknown = SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1,
): SyntheticPartnerCommunicationResult {
  const context = validateTrustedPartnerCommunicationEvent(input);
  return {
    context,
    response: {
      schemaVersion: PARTNER_COMMUNICATION_RESPONSE_SCHEMA_VERSION,
      accepted: true,
      duplicate: false,
      auditRef: 'synthetic-partner-contract-v1',
      identity: context.identity,
      decision: {
        type: 'no_action',
        text: null,
        confidence: null,
        policy: 'review_required',
        reasonCodes: ['synthetic_contract_only', 'communication_engine_not_invoked'],
      },
      operationalActions: [],
      handoff: null,
      resultingState: {
        conversation: 'active',
        issue: 'none',
        operatorRequired: false,
      },
    },
  };
}
