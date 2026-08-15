import 'server-only';

import {
  createPartnerCredentialAuthenticator,
  type AuthenticatedPartnerPrincipal,
  type PartnerCredentialDatabase,
} from '@/lib/partner-communication/auth';
import { decidePartnerCommunication } from '@/lib/partner-communication/brain';
import {
  createPartnerCanonicalContextResolver,
  type PartnerCanonicalContextDatabase,
} from '@/lib/partner-communication/canonical-context';
import {
  partnerSessionIdentityFromAuthenticatedPrincipal,
  createPartnerCommunicationStateRepository,
  type PartnerCommunicationStateDatabase,
} from '@/lib/partner-communication/state-repository';
import {
  createStrictPartnerPropertyKnowledgeLoader,
  type StrictPartnerPropertyKnowledgeDatabase,
} from '@/lib/partner-communication/strict-property-knowledge';
import {
  SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1,
  SYNTHETIC_APART_SHARING_PROPERTY_V1,
  SYNTHETIC_PARTNER_CREDENTIAL,
} from '@/lib/partner-communication/synthetic';
import { validateTrustedPartnerCommunicationEvent } from '@/lib/partner-communication/contract';
import {
  createPartnerRecoveryProcessor,
  createPartnerRecoveryRepository,
  deriveRecoveryMetrics,
  validateTrustedPartnerRecoveryEvent,
  type PartnerRecoveryDatabase,
} from '@/lib/partner-communication/recovery';
import { validateTrustedPartnerReviewEvent } from '@/lib/partner-reputation/contract';
import {
  derivePropertyReputationIntelligence,
  type ReputationAnalyticsReview,
} from '@/lib/partner-reputation/policy';
import {
  createPartnerReviewProcessor,
  type PartnerReputationDatabase,
} from '@/lib/partner-reputation/repository';
import {
  SYNTHETIC_APARTMENT_101_OBSERVATIONS,
  validatePartnerRevenueEvent,
} from '@/lib/partner-revenue/contract';
import {
  computeRecommendationConfidence,
  derivePilotKpis,
  runShadowBacktest,
} from '@/lib/partner-revenue/intelligence';
import {
  createPartnerRevenueProcessor,
  type PartnerRevenueDatabase,
} from '@/lib/partner-revenue/repository';
import {
  calculatePriceRecommendation,
  type MarketSignal,
  type PricingProfile,
} from '@/lib/booking-ops/pricing-intelligence-autopilot';

const DEMO_NOW = new Date('2026-08-15T12:00:00.000Z');
const ACCOUNT_ID = SYNTHETIC_PARTNER_CREDENTIAL.canonicalAccountId;
const PROPERTY_ID = SYNTHETIC_APART_SHARING_PROPERTY_V1.canonicalPropertyId;
const BOOKING_ID = SYNTHETIC_APART_SHARING_PROPERTY_V1.canonicalBookingId;
const PARTNER_ID = SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1.partner.partnerId;
const EXTERNAL_ACCOUNT_ID = SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1.partner.accountId;
const EXTERNAL_PROPERTY_ID = SYNTHETIC_APART_SHARING_PROPERTY_V1.externalPropertyId;
const EXTERNAL_BOOKING_ID = SYNTHETIC_APART_SHARING_PROPERTY_V1.externalBookingId;
const CONVERSATION_ID = SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1.conversation.conversationId;

type StateSessionRow = Parameters<PartnerCommunicationStateDatabase['insertSession']>[0];
type StateTurnRow = Parameters<PartnerCommunicationStateDatabase['insertTurn']>[0];
type StateHandoffRow = Parameters<PartnerCommunicationStateDatabase['insertHandoff']>[0];
type StateActionRow = Parameters<PartnerCommunicationStateDatabase['insertAction']>[0];
type RecoveryCaseRow = Parameters<PartnerRecoveryDatabase['insertCase']>[0];
type RecoveryEventRow = Parameters<PartnerRecoveryDatabase['insertEvent']>[0];
type ReviewRow = Awaited<ReturnType<PartnerReputationDatabase['findReview']>> extends infer Row | null ? Row : never;
type ReviewEventRow = Awaited<ReturnType<PartnerReputationDatabase['findEvent']>> extends infer Row | null ? Row : never;
type RevenueEventRow = Awaited<ReturnType<PartnerRevenueDatabase['findEvent']>> extends infer Row | null ? Row : never;
type RevenueObservationRow = Awaited<ReturnType<PartnerRevenueDatabase['findObservations']>>[number];
type RevenueRecommendationRow = Awaited<ReturnType<PartnerRevenueDatabase['findRecommendationsForEvent']>>[number];
type RevenueObservationStored = RevenueObservationRow & {
  account_id: string;
  partner_account_binding_id: string;
  partner_property_binding_id: string;
  property_id: string;
  source_event_id: string;
};
type RevenueRecommendationStored = RevenueRecommendationRow & {
  account_id: string;
  partner_account_binding_id: string;
  partner_property_binding_id: string;
  source_event_id: string;
};

function createCredentialDatabase(): PartnerCredentialDatabase {
  return {
    async findCredential(credentialId) {
      if (credentialId !== SYNTHETIC_PARTNER_CREDENTIAL.credentialId) return null;
      return {
        id: '40000000-0000-4000-8000-000000000004',
        partner_account_binding_id: SYNTHETIC_PARTNER_CREDENTIAL.partnerAccountBindingId,
        credential_id: credentialId,
        token_hash: SYNTHETIC_PARTNER_CREDENTIAL.tokenHash,
        status: 'active',
        expires_at: null,
      };
    },
    async findBinding(bindingId) {
      if (bindingId !== SYNTHETIC_PARTNER_CREDENTIAL.partnerAccountBindingId) return null;
      return {
        id: bindingId,
        account_id: ACCOUNT_ID,
        partner_id: PARTNER_ID,
        external_account_id: EXTERNAL_ACCOUNT_ID,
        status: 'active',
      };
    },
    async markCredentialUsed() {},
  };
}

function createCanonicalResolver() {
  const database: PartnerCanonicalContextDatabase = {
    async findPropertyBindings(input) {
      if (input.accountId !== ACCOUNT_ID || input.externalPropertyId !== EXTERNAL_PROPERTY_ID) return [];
      return [{
        account_id: ACCOUNT_ID,
        partner_account_binding_id: SYNTHETIC_PARTNER_CREDENTIAL.partnerAccountBindingId,
        external_property_id: EXTERNAL_PROPERTY_ID,
        property_id: PROPERTY_ID,
        status: 'active',
      }];
    },
    async findBookingBindings(input) {
      if (input.accountId !== ACCOUNT_ID || input.externalBookingId !== EXTERNAL_BOOKING_ID) return [];
      return [{
        account_id: ACCOUNT_ID,
        partner_account_binding_id: SYNTHETIC_PARTNER_CREDENTIAL.partnerAccountBindingId,
        external_booking_id: EXTERNAL_BOOKING_ID,
        booking_ops_record_id: BOOKING_ID,
        property_id: PROPERTY_ID,
        status: 'active',
      }];
    },
    async findCanonicalBooking(input) {
      return input.accountId === ACCOUNT_ID && input.bookingId === BOOKING_ID
        ? { id: BOOKING_ID, account_id: ACCOUNT_ID, property_id: PROPERTY_ID }
        : null;
    },
  };
  return createPartnerCanonicalContextResolver(database);
}

function createKnowledgeLoader() {
  const database: StrictPartnerPropertyKnowledgeDatabase = {
    async findActiveProperty(input) {
      return input.accountId === ACCOUNT_ID && input.propertyId === PROPERTY_ID
        ? { id: PROPERTY_ID, account_id: ACCOUNT_ID, status: 'active' }
        : null;
    },
    async findActiveKnowledge(propertyId) {
      return propertyId === PROPERTY_ID ? {
        property_id: PROPERTY_ID,
        active: true,
        wifi_name: SYNTHETIC_APART_SHARING_PROPERTY_V1.wifiName,
        wifi_password: SYNTHETIC_APART_SHARING_PROPERTY_V1.wifiPassword,
      } : null;
    },
  };
  return createStrictPartnerPropertyKnowledgeLoader(database);
}

function createStateMemory() {
  const sessions: StateSessionRow[] = [];
  const turns: StateTurnRow[] = [];
  const handoffs: StateHandoffRow[] = [];
  const actions: StateActionRow[] = [];
  const database: PartnerCommunicationStateDatabase = {
    async findBindings() { return []; },
    async findSession(input) {
      return sessions.find((row) => row.account_id === input.accountId
        && row.canonical_conversation_key === input.canonicalConversationKey) ?? null;
    },
    async getSession(input) {
      return sessions.find((row) => row.account_id === input.accountId && row.id === input.sessionId) ?? null;
    },
    async insertSession(row) {
      const duplicate = sessions.some((item) => item.account_id === row.account_id
        && item.canonical_conversation_key === row.canonical_conversation_key);
      if (duplicate) return { row: null, conflict: true };
      sessions.push(row); return { row, conflict: false };
    },
    async findTurn(input) {
      return turns.find((row) => row.account_id === input.accountId && row.session_id === input.sessionId
        && row.canonical_message_key === input.canonicalMessageKey && row.external_message_id === input.externalMessageId) ?? null;
    },
    async insertTurn(row) {
      const duplicate = turns.some((item) => item.account_id === row.account_id && item.session_id === row.session_id
        && item.canonical_message_key === row.canonical_message_key && item.external_message_id === row.external_message_id);
      if (duplicate) return { row: null, conflict: true };
      turns.push(row); return { row, conflict: false };
    },
    async findActiveHandoff(input) {
      return handoffs.find((row) => row.account_id === input.accountId && row.session_id === input.sessionId
        && ['pending', 'acknowledged'].includes(row.status)) ?? null;
    },
    async getHandoff(input) {
      return handoffs.find((row) => row.account_id === input.accountId && row.session_id === input.sessionId
        && row.id === input.handoffId) ?? null;
    },
    async insertHandoff(row) {
      if (handoffs.some((item) => item.account_id === row.account_id && item.session_id === row.session_id
        && ['pending', 'acknowledged'].includes(item.status))) return { row: null, conflict: true };
      handoffs.push(row); return { row, conflict: false };
    },
    async updateHandoff(input) {
      const row = handoffs.find((item) => item.account_id === input.accountId && item.session_id === input.sessionId
        && item.id === input.handoffId);
      if (!row) return null;
      Object.assign(row, input.patch); return row;
    },
    async findAction(input) {
      return actions.find((row) => row.account_id === input.accountId && row.session_id === input.sessionId
        && row.idempotency_key === input.idempotencyKey) ?? null;
    },
    async getAction(input) {
      return actions.find((row) => row.account_id === input.accountId && row.session_id === input.sessionId
        && row.id === input.actionId) ?? null;
    },
    async insertAction(row) {
      if (actions.some((item) => item.account_id === row.account_id && item.session_id === row.session_id
        && item.idempotency_key === row.idempotency_key)) return { row: null, conflict: true };
      actions.push(row); return { row, conflict: false };
    },
    async updateAction(input) {
      const row = actions.find((item) => item.account_id === input.accountId && item.session_id === input.sessionId
        && item.id === input.actionId);
      if (!row) return null;
      Object.assign(row, input.patch); return row;
    },
  };
  return { database, sessions, turns, handoffs, actions };
}

function createRecoveryMemory(stateMemory: ReturnType<typeof createStateMemory>) {
  const cases: RecoveryCaseRow[] = [];
  const events: RecoveryEventRow[] = [];
  const database: PartnerRecoveryDatabase = {
    async findCaseBySource(input) {
      return cases.find((row) => row.account_id === input.accountId && row.source_decision_id === input.sourceDecisionId) ?? null;
    },
    async findCaseByRef(input) {
      return cases.find((row) => row.account_id === input.accountId && row.public_recovery_ref === input.recoveryRef) ?? null;
    },
    async findActionByRef(input) {
      const row = stateMemory.actions.find((item) => item.account_id === input.accountId && item.public_action_ref === input.actionRef);
      return row ? { id: row.id, public_action_ref: row.public_action_ref, action_type: row.action_type } : null;
    },
    async getAction(input) {
      const row = stateMemory.actions.find((item) => item.account_id === input.accountId && item.id === input.actionId);
      return row ? { id: row.id, public_action_ref: row.public_action_ref, action_type: row.action_type } : null;
    },
    async findCaseByAction(input) {
      return cases.find((row) => row.account_id === input.accountId && row.action_id === input.actionId) ?? null;
    },
    async findSessionScope(input) {
      const row = stateMemory.sessions.find((item) => item.account_id === input.accountId && item.id === input.sessionId);
      return row ? {
        external_property_id: row.external_property_id,
        external_booking_id: row.external_booking_id,
        external_conversation_id: row.external_conversation_id,
      } : null;
    },
    async insertCase(row) {
      if (cases.some((item) => item.account_id === row.account_id && item.source_decision_id === row.source_decision_id)) {
        return { row: null, conflict: true };
      }
      cases.push(row); return { row, conflict: false };
    },
    async updateCase(input) {
      const row = cases.find((item) => item.account_id === input.accountId && item.id === input.caseId
        && item.status === input.expectedStatus);
      if (!row) return null;
      Object.assign(row, input.patch); return row;
    },
    async findEvent(input) {
      return events.find((row) => row.account_id === input.accountId && row.partner_id === input.partnerId
        && row.external_partner_account_id === input.externalPartnerAccountId && row.external_event_id === input.externalEventId) ?? null;
    },
    async insertEvent(row) {
      if (events.some((item) => item.account_id === row.account_id && item.partner_id === row.partner_id
        && item.external_partner_account_id === row.external_partner_account_id && item.external_event_id === row.external_event_id)) {
        return { row: null, conflict: true };
      }
      events.push(row); return { row, conflict: false };
    },
    async completeEvent(input) {
      const row = events.find((item) => item.account_id === input.accountId && item.id === input.eventId);
      if (!row) throw new Error('synthetic_recovery_event_missing');
      row.response = input.response; row.processed_at = input.processedAt;
    },
  };
  return { database, cases, events };
}

function createReputationMemory(recoveryMemory: ReturnType<typeof createRecoveryMemory>) {
  const events = new Map<string, ReviewEventRow>();
  const reviews = new Map<string, ReviewRow>();
  const signals: Array<Record<string, unknown>> = [];
  const database = {
    async findBindingScope(input: Parameters<PartnerReputationDatabase['findBindingScope']>[0]) {
      return {
        partner_booking_binding_id: '70000000-0000-4000-8000-000000000007',
        account_id: input.accountId,
        partner_account_binding_id: input.partnerAccountBindingId,
        external_property_id: input.externalPropertyId,
        external_booking_id: input.externalBookingId,
        property_id: PROPERTY_ID,
        booking_ops_record_id: BOOKING_ID,
      };
    },
    async findRecoveryCases() {
      return recoveryMemory.cases.map((row) => ({
        category: row.category,
        outcome: row.outcome,
        status: row.status,
        opened_at: '2026-08-15T12:05:00.000Z',
        operation_resolved_at: '2026-08-15T12:25:00.000Z',
        guest_confirmed_at: '2026-08-15T12:30:00.000Z',
      }));
    },
    async findEvent(input: Parameters<PartnerReputationDatabase['findEvent']>[0]) {
      return events.get(`${input.accountId}|${input.partnerAccountBindingId}|${input.externalEventId}`) ?? null;
    },
    async insertEvent(row: ReviewEventRow) {
      const key = `${row.account_id}|${row.partner_account_binding_id}|${row.external_event_id}`;
      if (events.has(key)) return { row: null, conflict: true };
      events.set(key, row); return { row, conflict: false };
    },
    async completeEvent(input: Parameters<PartnerReputationDatabase['completeEvent']>[0]) {
      const row = [...events.values()].find((item) => item.account_id === input.accountId && item.id === input.eventId);
      if (!row) throw new Error('synthetic_reputation_event_missing');
      row.review_id = input.reviewId; row.response = input.response; row.processed_at = input.processedAt;
    },
    async failEvent(input: Parameters<PartnerReputationDatabase['failEvent']>[0]) {
      const row = [...events.values()].find((item) => item.account_id === input.accountId && item.id === input.eventId);
      if (row) { row.error_code = input.errorCode; row.processed_at = input.processedAt; }
    },
    async findReview(input: Parameters<PartnerReputationDatabase['findReview']>[0]) {
      return reviews.get(`${input.partnerAccountBindingId}|${input.source}|${input.externalReviewId}`) ?? null;
    },
    async insertReview(row: ReviewRow) {
      const key = `${row.partner_account_binding_id}|${row.source}|${row.external_review_id}`;
      if (reviews.has(key)) return { row: null, conflict: true };
      reviews.set(key, row); return { row, conflict: false };
    },
    async insertSignal(row: Parameters<PartnerReputationDatabase['insertSignal']>[0]) {
      const duplicate = signals.some((item) => item.account_id === row.account_id
        && item.review_id === row.review_id && item.category === row.category);
      if (duplicate) return { row: null, conflict: true };
      signals.push(row); return { row, conflict: false };
    },
    async listPropertyReviews(input: Parameters<PartnerReputationDatabase['listPropertyReviews']>[0]) {
      return [...reviews.values()].filter((row) => row.account_id === input.accountId && row.property_id === input.propertyId);
    },
  } as PartnerReputationDatabase;
  return { database, events, reviews, signals };
}

function createRevenueMemory() {
  const events: RevenueEventRow[] = [];
  const observations: RevenueObservationStored[] = [];
  const recommendations: RevenueRecommendationStored[] = [];
  const database: PartnerRevenueDatabase = {
    async findPropertyBindings(input) {
      return input.accountId === ACCOUNT_ID && input.externalPropertyId === EXTERNAL_PROPERTY_ID ? [{
        id: '80000000-0000-4000-8000-000000000008',
        account_id: ACCOUNT_ID,
        partner_account_binding_id: SYNTHETIC_PARTNER_CREDENTIAL.partnerAccountBindingId,
        external_property_id: EXTERNAL_PROPERTY_ID,
        property_id: PROPERTY_ID,
        status: 'active',
      }] : [];
    },
    async findEvent(input) {
      return events.find((row) => row.partner_account_binding_id === input.partnerAccountBindingId
        && row.external_event_id === input.externalEventId) ?? null;
    },
    async insertEvent(row) {
      if (events.some((item) => item.partner_account_binding_id === row.partner_account_binding_id
        && item.external_event_id === row.external_event_id)) return { row: null, conflict: true };
      events.push(row); return { row, conflict: false };
    },
    async completeEvent(input) {
      const row = events.find((item) => item.account_id === input.accountId && item.id === input.eventId);
      if (!row) throw new Error('synthetic_revenue_event_missing');
      row.response = input.response; row.processed_at = input.processedAt;
    },
    async failEvent(input) {
      const row = events.find((item) => item.account_id === input.accountId && item.id === input.eventId);
      if (row) { row.error_code = input.errorCode; row.processed_at = input.processedAt; }
    },
    async saveObservation(input) {
      const existing = observations.find((row) => row.partner_account_binding_id === input.event.partner_account_binding_id
        && row.partner_property_binding_id === input.binding.id && row.stay_date === input.observation.stayDate);
      if (existing) return existing;
      const row = {
        id: '90000000-0000-4000-8000-000000000009',
        account_id: input.event.account_id,
        partner_account_binding_id: input.event.partner_account_binding_id,
        partner_property_binding_id: input.binding.id,
        property_id: input.binding.property_id,
        source_event_id: input.event.id,
        public_observation_ref: `obs_${'o'.repeat(32)}`,
        stay_date: input.observation.stayDate,
        current_price: input.observation.currentPrice,
        available_inventory: input.observation.availableInventory,
        sold_inventory: input.observation.soldInventory,
        realized_room_revenue: input.observation.realizedRoomRevenue,
        booking_lead_days: input.observation.bookingLeadDays,
        bookings_created: input.observation.bookingsCreated,
        cancellations: input.observation.cancellations,
        min_stay: input.observation.minStay,
        closed_to_arrival: input.observation.closedToArrival,
        currency: input.observation.currency,
        source: input.observation.source,
        observed_at: input.occurredAt,
      } satisfies RevenueObservationStored;
      observations.push(row); return row;
    },
    async findObservations(input) {
      return observations.filter((row) => row.account_id === input.accountId
        && row.partner_account_binding_id === input.partnerAccountBindingId
        && row.partner_property_binding_id === input.partnerPropertyBindingId
        && row.property_id === input.propertyId
        && (!input.stayDates || input.stayDates.includes(row.stay_date))).slice(0, input.limit ?? 365);
    },
    async findPricingProfiles() {
      return [{
        id: 'a0000000-0000-4000-8000-000000000010',
        property_setup_id: 'b0000000-0000-4000-8000-000000000011',
        property_id: PROPERTY_ID,
        status: 'ready_for_recommendations',
        pricing_strategy: 'balanced',
        base_price: 6000,
        min_price: 4500,
        max_price: 6500,
        currency: 'RUB',
        guardrails: {},
      }];
    },
    async findSignals() {
      return [{ source: 'internal', confidence_score: 90, updated_at: '2026-08-15T09:00:00.000Z' }];
    },
    async insertRecommendation(row) {
      const typed = row as RevenueRecommendationStored;
      recommendations.push(typed); return { row: typed, conflict: false };
    },
    async findRecommendationsForEvent(eventId) {
      return recommendations.filter((row) => row.source_event_id === eventId);
    },
    async findRecommendation(input) {
      return recommendations.find((row) => row.account_id === input.accountId
        && row.partner_account_binding_id === input.partnerAccountBindingId
        && row.partner_property_binding_id === input.partnerPropertyBindingId
        && row.public_recommendation_ref === input.recommendationRef) ?? null;
    },
    async insertFeedback(row) { return { row: row as never, conflict: false }; },
  };
  return { database, events, observations, recommendations };
}

function communicationEvent(input: { eventId: string; messageId: string; text: string; occurredAt: string }) {
  return validateTrustedPartnerCommunicationEvent({
    ...SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1,
    eventId: input.eventId,
    occurredAt: input.occurredAt,
    conversation: {
      ...SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1.conversation,
      messageId: input.messageId,
      text: input.text,
    },
  });
}

function recoveryEvent(input: {
  eventId: string;
  occurredAt: string;
  eventType: 'operation.updated' | 'guest.resolution.confirmed';
  actionRef?: string;
  recoveryRef?: string;
  status?: 'in_progress' | 'resolved';
  satisfied?: boolean;
}) {
  const base = {
    schemaVersion: 'partner.communication.v1',
    eventId: input.eventId,
    occurredAt: input.occurredAt,
    partner: { partnerId: PARTNER_ID, accountId: EXTERNAL_ACCOUNT_ID },
    property: { propertyId: EXTERNAL_PROPERTY_ID },
    booking: { bookingId: EXTERNAL_BOOKING_ID },
    conversation: { conversationId: CONVERSATION_ID },
  };
  return validateTrustedPartnerRecoveryEvent(input.eventType === 'operation.updated'
    ? { ...base, eventType: input.eventType, operation: {
      actionRef: input.actionRef, status: input.status,
      ...(input.status === 'resolved' ? { resolutionSummary: 'Отопление восстановлено.' } : {}),
    } }
    : { ...base, eventType: input.eventType, confirmation: {
      recoveryRef: input.recoveryRef, satisfied: input.satisfied,
    } });
}

function syntheticPricingSignals(): MarketSignal[] {
  return [{
    id: 'c0000000-0000-4000-8000-000000000012',
    propertySetupId: 'b0000000-0000-4000-8000-000000000011',
    propertyId: PROPERTY_ID,
    signalDate: '2026-08-22',
    radiusKm: 3,
    signalType: 'event_pressure',
    source: 'internal',
    value: { events: [{ name: 'Синтетическое событие', expected_impact: 'high' }] },
    confidenceScore: 90,
    metadata: { synthetic: true },
    createdAt: DEMO_NOW.toISOString(),
    updatedAt: DEMO_NOW.toISOString(),
  }];
}

function historicalReputationFixtures(): ReputationAnalyticsReview[] {
  return Array.from({ length: 4 }, (_, index) => ({
    reviewRef: `synthetic-history-${index + 1}`,
    normalizedRating: index === 0 ? 0.8 : 1,
    sentiment: index === 0 ? 'mixed' : 'positive',
    recoveryContext: index === 0 ? 'recovered_before_review' : 'no_recovery_case',
    categories: ['heating', 'maintenance'],
    receivedAt: `2026-08-${String(10 + index).padStart(2, '0')}T10:00:00.000Z`,
  }));
}

export async function runApartSharingKillerDemo() {
  const authenticate = createPartnerCredentialAuthenticator(createCredentialDatabase());
  const principal = await authenticate(new Headers({
    authorization: `Bearer ${SYNTHETIC_PARTNER_CREDENTIAL.token}`,
    'x-asi-partner-credential': SYNTHETIC_PARTNER_CREDENTIAL.credentialId,
  }));
  const resolveCanonical = createCanonicalResolver();
  const loadKnowledge = createKnowledgeLoader();
  const stateMemory = createStateMemory();
  const state = createPartnerCommunicationStateRepository(stateMemory.database);

  const wifiContext = communicationEvent({
    eventId: 'demo-wifi-event', messageId: 'demo-wifi-message',
    text: 'Какой пароль от Wi-Fi?', occurredAt: '2026-08-15T12:00:00.000Z',
  });
  const canonical = await resolveCanonical(principal, wifiContext);
  if (canonical.status !== 'resolved') throw new Error('synthetic_canonical_resolution_failed');
  const session = await state.getOrCreatePartnerSession({
    accountId: ACCOUNT_ID,
    identity: partnerSessionIdentityFromAuthenticatedPrincipal(principal, wifiContext),
  });
  const knowledge = await loadKnowledge({ accountId: ACCOUNT_ID, propertyId: canonical.propertyId });
  const wifi = decidePartnerCommunication({ principal, context: wifiContext, canonical, session, knowledge });
  await state.appendPartnerTurn({
    accountId: ACCOUNT_ID, sessionId: session.id, canonicalMessageKey: wifiContext.keys.partnerMessageKey,
    externalMessageId: wifiContext.identity.messageId, direction: 'inbound', text: wifiContext.message.text,
  });

  const heatingContext = communicationEvent({
    eventId: 'demo-heating-event', messageId: 'demo-heating-message',
    text: 'Не работает отопление.', occurredAt: '2026-08-15T12:05:00.000Z',
  });
  const heating = decidePartnerCommunication({ principal, context: heatingContext, canonical, session, knowledge });
  await state.appendPartnerTurn({
    accountId: ACCOUNT_ID, sessionId: session.id, canonicalMessageKey: heatingContext.keys.partnerMessageKey,
    externalMessageId: heatingContext.identity.messageId, direction: 'inbound', text: heatingContext.message.text,
  });
  if (!heating.actionRecommendation || !heating.handoffRecommendation) throw new Error('synthetic_heating_escalation_failed');
  const handoff = await state.createOrReusePartnerHandoff({
    accountId: ACCOUNT_ID, sessionId: session.id,
    reasonCode: heating.handoffRecommendation.reasonCode, priority: heating.handoffRecommendation.priority,
  });
  const actionInput = {
    accountId: ACCOUNT_ID,
    sessionId: session.id,
    idempotencyKey: `${heatingContext.keys.partnerEventIdempotencyKey}|maintenance_issue`,
    actionType: heating.actionRecommendation.actionType,
    priority: heating.actionRecommendation.priority,
    status: 'recommended' as const,
    reasonCode: heating.actionRecommendation.reasonCode,
  };
  const action = await state.createOrReusePartnerAction(actionInput);
  const actionReplay = await state.createOrReusePartnerAction(actionInput);

  const recoveryMemory = createRecoveryMemory(stateMemory);
  const recoveryRepository = createPartnerRecoveryRepository(recoveryMemory.database);
  const opened = await recoveryRepository.openMaintenanceCase({
    accountId: ACCOUNT_ID, sessionId: session.id,
    sourceInboxId: 'd0000000-0000-4000-8000-000000000013',
    sourceDecisionId: 'e0000000-0000-4000-8000-000000000014',
    actionId: action.id, actionRef: action.publicActionRef, handoffId: handoff.id,
    issueSummary: heatingContext.message.text, severity: 'high', openedAt: heatingContext.occurredAt,
  });
  const processRecovery = createPartnerRecoveryProcessor(recoveryMemory.database, {
    resolveCanonical,
    state,
  });
  const inProgress = await processRecovery(principal, recoveryEvent({
    eventId: 'demo-operation-in-progress', occurredAt: '2026-08-15T12:10:00.000Z',
    eventType: 'operation.updated', actionRef: action.publicActionRef, status: 'in_progress',
  }));
  const technicallyResolved = await processRecovery(principal, recoveryEvent({
    eventId: 'demo-operation-resolved', occurredAt: '2026-08-15T12:25:00.000Z',
    eventType: 'operation.updated', actionRef: action.publicActionRef, status: 'resolved',
  }));
  const recovered = await processRecovery(principal, recoveryEvent({
    eventId: 'demo-guest-confirmed', occurredAt: '2026-08-15T12:30:00.000Z',
    eventType: 'guest.resolution.confirmed', recoveryRef: opened.recoveryRef, satisfied: true,
  }));
  const recoveryMetrics = deriveRecoveryMetrics({
    openedAt: '2026-08-15T12:05:00.000Z',
    operationResolvedAt: '2026-08-15T12:25:00.000Z',
    guestConfirmedAt: '2026-08-15T12:30:00.000Z',
  });

  const reputationMemory = createReputationMemory(recoveryMemory);
  const processReview = createPartnerReviewProcessor(reputationMemory.database, { resolveCanonical });
  const reviewContext = validateTrustedPartnerReviewEvent({
    schemaVersion: 'partner.reputation.v1',
    eventId: 'demo-review-event',
    eventType: 'review.received',
    occurredAt: '2026-08-16T10:00:00.000Z',
    partner: { partnerId: PARTNER_ID, accountId: EXTERNAL_ACCOUNT_ID },
    property: { propertyId: EXTERNAL_PROPERTY_ID },
    booking: { bookingId: EXTERNAL_BOOKING_ID },
    review: {
      reviewId: 'demo-review-1', source: 'apart-sharing-demo', rating: 5, ratingScale: 5,
      text: 'Сначала было холодно, но проблему быстро решили. Спасибо.', language: 'ru',
      publishedAt: '2026-08-16T09:30:00.000Z',
    },
  });
  const review = await processReview(principal, reviewContext);
  const reputationIntelligence = derivePropertyReputationIntelligence(historicalReputationFixtures(), 30);

  const revenueMemory = createRevenueMemory();
  const pricingProfile = {
    basePrice: 6000, minPrice: 4500, maxPrice: 6500, pricingStrategy: 'balanced',
  } satisfies Pick<PricingProfile, 'basePrice' | 'minPrice' | 'maxPrice' | 'pricingStrategy'>;
  const processRevenue = createPartnerRevenueProcessor(revenueMemory.database, {
    recommend: async (_profileId, stayDate) => {
      const result = calculatePriceRecommendation({
        profile: pricingProfile,
        date: stayDate,
        signals: syntheticPricingSignals(),
        audienceProfile: null,
        now: DEMO_NOW,
      });
      return { recommendedPrice: result.recommendedPrice, reasons: result.reasons };
    },
  });
  const revenueBase = {
    schemaVersion: 'partner.revenue.v1',
    occurredAt: '2026-08-15T12:35:00.000Z',
    partner: { partnerId: PARTNER_ID, accountId: EXTERNAL_ACCOUNT_ID },
    property: { propertyId: EXTERNAL_PROPERTY_ID },
  };
  await processRevenue(principal, validatePartnerRevenueEvent({
    ...revenueBase,
    eventId: 'demo-revenue-observation',
    eventType: 'revenue.observation.recorded',
    observation: {
      stayDate: '2026-08-22', currentPrice: 6000, availableInventory: 1, soldInventory: 0,
      realizedRoomRevenue: 0, bookingLeadDays: 7, bookingsCreated: 0, cancellations: 0,
      minStay: 2, closedToArrival: false, currency: 'RUB',
    },
  }));
  const shadow = await processRevenue(principal, validatePartnerRevenueEvent({
    ...revenueBase,
    eventId: 'demo-shadow-request',
    eventType: 'pricing.shadow.requested',
    request: { stayDates: ['2026-08-22'] },
  }));
  if (!('recommendations' in shadow)) throw new Error('synthetic_shadow_pricing_failed');
  const recommendation = shadow.recommendations[0];

  const historyConfidence = SYNTHETIC_APARTMENT_101_OBSERVATIONS.map((observation) => computeRecommendationConfidence({
    profileReady: true,
    signals: [{ source: 'internal', confidenceScore: 90, updatedAt: '2026-08-15T09:00:00.000Z' }],
    observation,
    historicalSampleSize: SYNTHETIC_APARTMENT_101_OBSERVATIONS.length,
    now: DEMO_NOW,
  }));
  const historicalRecommendations = SYNTHETIC_APARTMENT_101_OBSERVATIONS.map((observation, index) => ({
    stayDate: observation.stayDate,
    currentPrice: observation.currentPrice,
    recommendedPrice: observation.currentPrice,
    confidence: historyConfidence[index].confidence,
    confidenceBand: historyConfidence[index].confidenceBand,
  }));
  const historicalEvidence = runShadowBacktest({
    observations: SYNTHETIC_APARTMENT_101_OBSERVATIONS,
    recommendations: historicalRecommendations,
  });
  const pilotKpis = derivePilotKpis({
    observations: SYNTHETIC_APARTMENT_101_OBSERVATIONS,
    recommendations: historicalRecommendations,
  });

  return Object.freeze({
    demoVersion: 'apart-sharing-killer-demo.v1',
    synthetic: true,
    partner: { id: PARTNER_ID, role: 'target_partner', integrationStatus: 'not_integrated' },
    property: { id: EXTERNAL_PROPERTY_ID, name: SYNTHETIC_APART_SHARING_PROPERTY_V1.name },
    booking: { id: EXTERNAL_BOOKING_ID },
    communication: {
      authenticated: true,
      routine: {
        guestMessage: wifiContext.message.text,
        answer: wifi.decision.text,
        decision: wifi.decision.type,
        policy: wifi.decision.policy,
        grounded: wifi.decision.reasonCodes.includes('grounded_wifi'),
        operatorRequired: false,
        responseLatencyMs: 0,
        routineHumanTouchAvoided: true,
      },
      operationalIssue: {
        guestMessage: heatingContext.message.text,
        category: 'heating',
        actionType: action.actionType,
        actionReused: action.id === actionReplay.id,
        handoffStatus: handoff.status,
        operatorRequired: true,
      },
      outboundGuestMessages: 0,
    },
    serviceRecovery: {
      caseCount: recoveryMemory.cases.length,
      opened: opened.status,
      inProgress: inProgress.recovery.status,
      technicalResolution: {
        status: technicallyResolved.recovery.status,
        recovered: technicallyResolved.recovery.status === 'recovered',
        followupPrepared: technicallyResolved.decision.followupRecommendation,
        followupSent: false,
      },
      guestConfirmation: {
        satisfied: true,
        status: recovered.recovery.status,
        outcome: recovered.recovery.outcome,
        operatorRequired: recovered.recovery.operatorRequired,
      },
      metrics: recoveryMetrics,
    },
    reputation: {
      review: { rating: 5, scale: 5, text: reviewContext.review.text },
      analysis: review.analysis,
      responseDraft: {
        text: review.responseRecommendation.text,
        policy: review.responseRecommendation.policy,
        safe: review.responseRecommendation.policy === 'draft_safe',
        publiclyPublished: false,
      },
      signals: review.reputationSignals,
      propertyIntelligence: {
        synthetic: true,
        windowDays: reputationIntelligence.windowDays,
        reviewCount: reputationIntelligence.reviewCount,
        heatingMentions: reputationIntelligence.categoryCounts.heating ?? 0,
        trendSignal: reputationIntelligence.trendSignal,
        recurringIssues: reputationIntelligence.recurringIssues,
      },
    },
    revenue: {
      recommendation: {
        stayDate: recommendation.stayDate,
        currentRate: recommendation.currentPrice,
        shadowRecommendedRate: recommendation.recommendedPrice,
        delta: recommendation.changeAmount,
        confidence: recommendation.confidence,
        confidenceBand: recommendation.confidenceBand,
        reasonCodes: recommendation.reasonCodes,
        adjustmentReasons: recommendation.adjustmentReasons,
        guardrails: recommendation.guardrails,
        mode: recommendation.mode,
        priceChanged: false,
      },
      historicalEvidence: {
        fixtureNights: SYNTHETIC_APARTMENT_101_OBSERVATIONS.length,
        observedMetrics: historicalEvidence.observedMetrics,
        recommendationCoverage: pilotKpis.recommendationCoverage,
        averageConfidence: pilotKpis.averageConfidence,
        dataSufficiency: historicalEvidence.dataSufficiency,
        provenRevenueUplift: historicalEvidence.provenRevenueUplift,
        counterfactual: historicalEvidence.counterfactualStatus,
      },
    },
    pilotKpis: {
      communicationOperations: [
        'inbound_guest_conversations', 'routine_answer_coverage', 'operator_escalation_rate',
        'operator_touches_per_routine_conversation', 'time_to_decision', 'maintenance_access_issue_count',
        'complaint_to_action', 'action_to_resolution', 'resolution_to_guest_confirmation', 'recovered_unrecovered_rate',
      ],
      reputation: [
        'rating_distribution', 'negative_mixed_rate', 'reviews_linked_to_recovery',
        'recurring_issue_categories', 'response_draft_coverage', 'human_review_rate',
      ],
      revenue: [
        'observation_coverage', 'shadow_recommendation_coverage', 'recommendation_confidence',
        'acceptance_rejection', 'actual_occupancy', 'actual_adr', 'actual_revpar', 'recommendation_deltas',
      ],
    },
    sideEffects: {
      productionChanged: false,
      stagingChanged: false,
      externalCalls: 0,
      otaPriceWrites: 0,
      outboundGuestMessages: 0,
      publicReviewPublications: 0,
    },
    claims: {
      provenInCode: ['grounded communication', 'service recovery states', 'review analysis', 'shadow pricing'],
      syntheticDemo: ['Apartment 101 story', 'historical review fixtures', '75-night revenue fixture'],
      pilotMeasurable: ['operator capacity', 'recovery outcomes', 'review patterns', 'pricing recommendation acceptance'],
      notYetProven: ['labor savings', 'revenue uplift', 'review-score improvement', 'headcount reduction', 'conversion uplift'],
    },
    disclaimers: [
      'All demo data is synthetic.',
      'Apart Sharing is a target partner; ASI is not integrated with Apart Sharing.',
      'No Apart Sharing API credentials or adapter are present.',
      'A scoped integration depends on available API, export, or webhook interfaces.',
      'Shadow pricing is advisory and does not change OTA prices.',
      'No guest message is sent and no public review response is published.',
      'Revenue uplift and counterfactual impact are not proven.',
    ],
  });
}

export type ApartSharingKillerDemoResult = Awaited<ReturnType<typeof runApartSharingKillerDemo>>;
