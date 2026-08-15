import 'server-only';

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { AuthenticatedPartnerPrincipal } from '@/lib/partner-communication/auth';
import { resolvePartnerCanonicalContext } from '@/lib/partner-communication/canonical-context';
import type {
  PartnerRecoveryContext,
  PartnerReputationCategory,
  PartnerReputationRisk,
  PartnerReviewResponsePolicy,
  PartnerReviewSentiment,
  PartnerReviewSeverity,
  TrustedPartnerReviewContext,
} from './contract';
import {
  classifyPartnerReview,
  deriveObservationalRecoveryReviewKpis,
  derivePropertyReputationIntelligence,
  recommendPartnerReviewResponse,
  summarizeRecoveryFacts,
  type PartnerReviewAnalysis,
  type RecoveryFact,
  type ReputationAnalyticsReview,
  type ResponseRecommendation,
} from './policy';

type BindingScopeRow = {
  partner_booking_binding_id: string;
  account_id: string;
  partner_account_binding_id: string;
  external_property_id: string;
  external_booking_id: string;
  property_id: string;
  booking_ops_record_id: string;
};

type ReviewRow = {
  id: string;
  account_id: string;
  partner_account_binding_id: string;
  partner_booking_binding_id: string;
  property_id: string;
  booking_ops_record_id: string;
  external_review_id: string;
  source: string;
  public_review_ref: string;
  review_fingerprint: string;
  rating_value: number;
  rating_scale_max: number;
  normalized_rating: number;
  title: string | null;
  review_text: string;
  language: string | null;
  published_at: string | null;
  received_at: string;
  sentiment: PartnerReviewSentiment;
  severity: PartnerReviewSeverity;
  categories: PartnerReputationCategory[];
  reputation_risk: PartnerReputationRisk;
  recovery_context: PartnerRecoveryContext;
  recovery_facts: RecoveryFact[];
  sensitive_allegations: string[];
  response_text: string;
  response_policy: PartnerReviewResponsePolicy;
  response_reason_codes: string[];
  created_at: string;
  updated_at: string;
};

type EventRow = {
  id: string;
  account_id: string;
  partner_account_binding_id: string;
  external_event_id: string;
  event_fingerprint: string;
  review_id: string | null;
  audit_ref: string;
  response: PartnerReviewEnvelopeV1 | null;
  error_code: 'partner_review_conflict' | 'partner_review_processing_failed' | null;
  created_at: string;
  processed_at: string | null;
};

type SignalRow = {
  id: string;
  account_id: string;
  review_id: string;
  property_id: string;
  booking_ops_record_id: string;
  category: PartnerReputationCategory;
  severity: PartnerReviewSeverity;
  source: string;
  recovery_context: PartnerRecoveryContext;
  created_at: string;
};

type RecoveryRow = {
  category: string;
  outcome: 'satisfied' | 'not_satisfied' | null;
  status: string;
  opened_at: string;
  operation_resolved_at: string | null;
  guest_confirmed_at: string | null;
};

type InsertResult<T> = { row: T | null; conflict: boolean };

export interface PartnerReputationDatabase {
  findBindingScope(input: {
    accountId: string;
    partnerAccountBindingId: string;
    externalPropertyId: string;
    externalBookingId: string;
  }): Promise<BindingScopeRow | null>;
  findRecoveryCases(input: {
    accountId: string;
    partnerId: string;
    externalPartnerAccountId: string;
    externalPropertyId: string;
    externalBookingId: string;
    before: string;
  }): Promise<RecoveryRow[]>;
  findEvent(input: { accountId: string; partnerAccountBindingId: string; externalEventId: string }): Promise<EventRow | null>;
  insertEvent(row: EventRow): Promise<InsertResult<EventRow>>;
  completeEvent(input: { accountId: string; eventId: string; reviewId: string; response: PartnerReviewEnvelopeV1; processedAt: string }): Promise<void>;
  failEvent(input: { accountId: string; eventId: string; errorCode: EventRow['error_code']; processedAt: string }): Promise<void>;
  findReview(input: { partnerAccountBindingId: string; source: string; externalReviewId: string }): Promise<ReviewRow | null>;
  insertReview(row: ReviewRow): Promise<InsertResult<ReviewRow>>;
  insertSignal(row: SignalRow): Promise<InsertResult<SignalRow>>;
  listPropertyReviews(input: { accountId: string; propertyId: string; since: string }): Promise<ReviewRow[]>;
}

export type PartnerReviewEnvelopeV1 = Readonly<{
  schemaVersion: 'partner.reputation.response.v1';
  accepted: true;
  duplicate: boolean;
  auditRef: string;
  review: Readonly<{ reviewRef: string; source: string; normalizedRating: number }>;
  analysis: Readonly<{
    sentiment: PartnerReviewSentiment;
    severity: PartnerReviewSeverity;
    categories: readonly PartnerReputationCategory[];
    reputationRisk: PartnerReputationRisk;
    recoveryContext: PartnerRecoveryContext;
    recoveryFacts: readonly RecoveryFact[];
  }>;
  responseRecommendation: ResponseRecommendation;
  reputationSignals: ReadonlyArray<{
    category: PartnerReputationCategory;
    severity: PartnerReviewSeverity;
    source: string;
    recoveryContext: PartnerRecoveryContext;
  }>;
}>;

export class PartnerReputationError extends Error {
  constructor(readonly code:
    | 'partner_event_conflict'
    | 'partner_review_conflict'
    | 'partner_reputation_scope_invalid'
    | 'partner_review_processing_failed') {
    super(code);
    this.name = 'PartnerReputationError';
  }
}

type Dependencies = { resolveCanonical: typeof resolvePartnerCanonicalContext };

function sha(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}
function auditRef(): string { return `pra_${randomBytes(24).toString('base64url')}`; }
function reviewRef(): string { return `prev_${randomBytes(24).toString('base64url')}`; }
function latency(from: string | null, to: string | null): number | null {
  return from && to ? Math.max(0, Date.parse(to) - Date.parse(from)) : null;
}

function recoveryFact(row: RecoveryRow): RecoveryFact {
  return Object.freeze({
    category: row.category,
    outcome: row.outcome,
    status: row.status,
    openedAt: row.opened_at,
    operationResolvedAt: row.operation_resolved_at,
    guestConfirmedAt: row.guest_confirmed_at,
    resolutionLatencyMs: latency(row.opened_at, row.operation_resolved_at),
    confirmationLatencyMs: latency(row.operation_resolved_at, row.guest_confirmed_at),
    totalRecoveryLatencyMs: latency(row.opened_at, row.guest_confirmed_at),
  });
}

function publicAnalysis(row: ReviewRow): PartnerReviewAnalysis {
  return {
    sentiment: row.sentiment,
    severity: row.severity,
    categories: row.categories,
    reputationRisk: row.reputation_risk,
    recoveryContext: row.recovery_context,
    recoveryFacts: row.recovery_facts,
    sensitiveAllegations: row.sensitive_allegations as PartnerReviewAnalysis['sensitiveAllegations'],
  };
}

function recommendation(row: ReviewRow): ResponseRecommendation {
  return { text: row.response_text, policy: row.response_policy, reasonCodes: row.response_reason_codes };
}

function signalCategories(analysis: PartnerReviewAnalysis): PartnerReputationCategory[] {
  if (analysis.sentiment === 'positive' && analysis.recoveryContext === 'no_recovery_case') return [];
  return [...analysis.categories].filter((category) => category !== 'other').slice(0, 8);
}

function envelope(row: ReviewRow, event: EventRow, duplicate: boolean): PartnerReviewEnvelopeV1 {
  const analysis = publicAnalysis(row);
  return Object.freeze({
    schemaVersion: 'partner.reputation.response.v1',
    accepted: true,
    duplicate,
    auditRef: event.audit_ref,
    review: { reviewRef: row.public_review_ref, source: row.source, normalizedRating: Number(row.normalized_rating) },
    analysis: {
      sentiment: analysis.sentiment,
      severity: analysis.severity,
      categories: analysis.categories,
      reputationRisk: analysis.reputationRisk,
      recoveryContext: analysis.recoveryContext,
      recoveryFacts: analysis.recoveryFacts,
    },
    responseRecommendation: recommendation(row),
    reputationSignals: signalCategories(analysis).map((category) => ({
      category,
      severity: analysis.severity,
      source: row.source,
      recoveryContext: analysis.recoveryContext,
    })),
  });
}

function eventIdentity(principal: AuthenticatedPartnerPrincipal, context: TrustedPartnerReviewContext) {
  return { accountId: principal.accountId, partnerAccountBindingId: principal.partnerAccountBindingId, externalEventId: context.identity.eventId };
}

async function waitForEvent(database: PartnerReputationDatabase, identity: ReturnType<typeof eventIdentity>): Promise<EventRow | null> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const stored = await database.findEvent(identity);
    if (stored?.response || stored?.error_code) return stored;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

function throwStoredError(event: EventRow): never {
  if (event.error_code === 'partner_review_conflict') throw new PartnerReputationError('partner_review_conflict');
  throw new PartnerReputationError('partner_review_processing_failed');
}

export function createPartnerReviewProcessor(
  database: PartnerReputationDatabase,
  dependencies: Dependencies = { resolveCanonical: resolvePartnerCanonicalContext },
) {
  return async function process(
    principal: AuthenticatedPartnerPrincipal,
    context: TrustedPartnerReviewContext,
  ): Promise<PartnerReviewEnvelopeV1> {
    if (principal.partnerId !== context.identity.partnerId || principal.externalPartnerAccountId !== context.identity.accountId) {
      throw new PartnerReputationError('partner_reputation_scope_invalid');
    }
    const canonical = await dependencies.resolveCanonical(principal, context);
    if (canonical.status !== 'resolved') throw new PartnerReputationError('partner_reputation_scope_invalid');
    const binding = await database.findBindingScope({
      accountId: principal.accountId,
      partnerAccountBindingId: principal.partnerAccountBindingId,
      externalPropertyId: context.identity.propertyId,
      externalBookingId: context.identity.bookingId,
    });
    if (!binding
      || binding.account_id !== canonical.accountId
      || binding.partner_account_binding_id !== principal.partnerAccountBindingId
      || binding.property_id !== canonical.propertyId
      || binding.booking_ops_record_id !== canonical.bookingId) {
      throw new PartnerReputationError('partner_reputation_scope_invalid');
    }

    const identity = eventIdentity(principal, context);
    const eventFingerprint = sha(context);
    let storedEvent = await database.findEvent(identity);
    if (storedEvent) {
      if (storedEvent.event_fingerprint !== eventFingerprint) throw new PartnerReputationError('partner_event_conflict');
      if (storedEvent.error_code) throwStoredError(storedEvent);
      if (storedEvent.response) return { ...storedEvent.response, duplicate: true };
      const completed = await waitForEvent(database, identity);
      if (!completed) throw new PartnerReputationError('partner_review_processing_failed');
      if (completed.error_code) throwStoredError(completed);
      if (!completed.response) throw new PartnerReputationError('partner_review_processing_failed');
      return { ...completed.response, duplicate: true };
    }

    const now = new Date().toISOString();
    const eventRow: EventRow = {
      id: randomUUID(),
      account_id: principal.accountId,
      partner_account_binding_id: principal.partnerAccountBindingId,
      external_event_id: context.identity.eventId,
      event_fingerprint: eventFingerprint,
      review_id: null,
      audit_ref: auditRef(),
      response: null,
      error_code: null,
      created_at: now,
      processed_at: null,
    };
    const eventInsert = await database.insertEvent(eventRow);
    if (!eventInsert.row) {
      if (!eventInsert.conflict) throw new PartnerReputationError('partner_review_processing_failed');
      storedEvent = await database.findEvent(identity);
      if (!storedEvent || storedEvent.event_fingerprint !== eventFingerprint) throw new PartnerReputationError('partner_event_conflict');
      const completed = await waitForEvent(database, identity);
      if (!completed) throw new PartnerReputationError('partner_review_processing_failed');
      if (completed.error_code) throwStoredError(completed);
      if (!completed.response) throw new PartnerReputationError('partner_review_processing_failed');
      return { ...completed.response, duplicate: true };
    }

    const reviewFingerprint = sha({
      binding: binding.partner_booking_binding_id,
      source: context.review.source,
      externalReviewId: context.review.reviewId,
      rating: context.review.rating,
      ratingScale: context.review.ratingScale,
      title: context.review.title,
      text: context.review.text,
      language: context.review.language,
      publishedAt: context.review.publishedAt,
    });
    const reviewIdentity = {
      partnerAccountBindingId: principal.partnerAccountBindingId,
      source: context.review.source,
      externalReviewId: context.review.reviewId,
    };
    let storedReview = await database.findReview(reviewIdentity);
    if (storedReview && storedReview.review_fingerprint !== reviewFingerprint) {
      await database.failEvent({ accountId: principal.accountId, eventId: eventRow.id, errorCode: 'partner_review_conflict', processedAt: now });
      throw new PartnerReputationError('partner_review_conflict');
    }

    if (!storedReview) {
      const recoveryRows = await database.findRecoveryCases({
        accountId: principal.accountId,
        partnerId: principal.partnerId,
        externalPartnerAccountId: principal.externalPartnerAccountId,
        externalPropertyId: context.identity.propertyId,
        externalBookingId: context.identity.bookingId,
        before: context.review.publishedAt ?? context.occurredAt,
      });
      const recovery = summarizeRecoveryFacts(recoveryRows.map(recoveryFact));
      const analysis = classifyPartnerReview(context, recovery);
      const response = recommendPartnerReviewResponse(analysis);
      const reviewRow: ReviewRow = {
        id: randomUUID(),
        account_id: principal.accountId,
        partner_account_binding_id: principal.partnerAccountBindingId,
        partner_booking_binding_id: binding.partner_booking_binding_id,
        property_id: canonical.propertyId,
        booking_ops_record_id: canonical.bookingId,
        external_review_id: context.review.reviewId,
        source: context.review.source,
        public_review_ref: reviewRef(),
        review_fingerprint: reviewFingerprint,
        rating_value: context.review.rating,
        rating_scale_max: context.review.ratingScale,
        normalized_rating: context.review.normalizedRating,
        title: context.review.title,
        review_text: context.review.text,
        language: context.review.language,
        published_at: context.review.publishedAt,
        received_at: context.occurredAt,
        sentiment: analysis.sentiment,
        severity: analysis.severity,
        categories: [...analysis.categories],
        reputation_risk: analysis.reputationRisk,
        recovery_context: analysis.recoveryContext,
        recovery_facts: [...analysis.recoveryFacts],
        sensitive_allegations: [...analysis.sensitiveAllegations],
        response_text: response.text,
        response_policy: response.policy,
        response_reason_codes: [...response.reasonCodes],
        created_at: now,
        updated_at: now,
      };
      const inserted = await database.insertReview(reviewRow);
      if (inserted.row) storedReview = inserted.row;
      else if (inserted.conflict) {
        storedReview = await database.findReview(reviewIdentity);
        if (!storedReview || storedReview.review_fingerprint !== reviewFingerprint) {
          await database.failEvent({ accountId: principal.accountId, eventId: eventRow.id, errorCode: 'partner_review_conflict', processedAt: now });
          throw new PartnerReputationError('partner_review_conflict');
        }
      } else throw new PartnerReputationError('partner_review_processing_failed');
    }
    if (!storedReview) throw new PartnerReputationError('partner_review_processing_failed');

    const storedAnalysis = publicAnalysis(storedReview);
    for (const category of signalCategories(storedAnalysis)) {
      await database.insertSignal({
        id: randomUUID(), account_id: storedReview.account_id, review_id: storedReview.id,
        property_id: storedReview.property_id, booking_ops_record_id: storedReview.booking_ops_record_id,
        category, severity: storedReview.severity, source: storedReview.source,
        recovery_context: storedReview.recovery_context, created_at: now,
      });
    }
    const result = envelope(storedReview, eventRow, false);
    await database.completeEvent({ accountId: principal.accountId, eventId: eventRow.id, reviewId: storedReview.id, response: result, processedAt: now });
    return result;
  };
}

function persistence(): never { throw new PartnerReputationError('partner_review_processing_failed'); }
function conflict(error: { code?: string } | null): boolean { return error?.code === '23505'; }

export function createSupabasePartnerReputationDatabase(client: SupabaseClient): PartnerReputationDatabase {
  return {
    async findBindingScope(input) {
      const { data, error } = await client.from('partner_booking_bindings').select('id,account_id,partner_account_binding_id,external_booking_id,booking_ops_record_id,property_id')
        .eq('account_id', input.accountId).eq('partner_account_binding_id', input.partnerAccountBindingId)
        .eq('external_booking_id', input.externalBookingId).eq('status', 'active').maybeSingle();
      if (error) persistence();
      if (!data) return null;
      const { data: property, error: propertyError } = await client.from('partner_property_bindings').select('external_property_id')
        .eq('account_id', input.accountId).eq('partner_account_binding_id', input.partnerAccountBindingId)
        .eq('external_property_id', input.externalPropertyId).eq('property_id', data.property_id).eq('status', 'active').maybeSingle();
      if (propertyError) persistence();
      return property ? {
        partner_booking_binding_id: data.id,
        account_id: data.account_id,
        partner_account_binding_id: data.partner_account_binding_id,
        external_property_id: property.external_property_id,
        external_booking_id: data.external_booking_id,
        property_id: data.property_id,
        booking_ops_record_id: data.booking_ops_record_id,
      } as BindingScopeRow : null;
    },
    async findRecoveryCases(input) {
      const { data, error } = await client.from('partner_service_recovery_cases')
        .select('category,outcome,status,opened_at,operation_resolved_at,guest_confirmed_at,partner_communication_sessions!inner(partner_id,external_partner_account_id,external_property_id,external_booking_id)')
        .eq('account_id', input.accountId)
        .eq('partner_communication_sessions.partner_id', input.partnerId)
        .eq('partner_communication_sessions.external_partner_account_id', input.externalPartnerAccountId)
        .eq('partner_communication_sessions.external_property_id', input.externalPropertyId)
        .eq('partner_communication_sessions.external_booking_id', input.externalBookingId)
        .lte('opened_at', input.before).order('opened_at', { ascending: false }).limit(6);
      if (error) persistence();
      return (data ?? []) as unknown as RecoveryRow[];
    },
    async findEvent(input) {
      const { data, error } = await client.from('partner_review_events').select('*')
        .eq('account_id', input.accountId).eq('partner_account_binding_id', input.partnerAccountBindingId)
        .eq('external_event_id', input.externalEventId).maybeSingle();
      if (error) persistence();
      return data as EventRow | null;
    },
    async insertEvent(row) {
      const { data, error } = await client.from('partner_review_events').insert(row).select('*').maybeSingle();
      if (error && !conflict(error)) persistence();
      return { row: data as EventRow | null, conflict: conflict(error) };
    },
    async completeEvent(input) {
      const { data, error } = await client.from('partner_review_events')
        .update({ review_id: input.reviewId, response: input.response, processed_at: input.processedAt })
        .eq('account_id', input.accountId).eq('id', input.eventId).is('processed_at', null).select('id').maybeSingle();
      if (error || !data) persistence();
    },
    async failEvent(input) {
      const { error } = await client.from('partner_review_events')
        .update({ error_code: input.errorCode, processed_at: input.processedAt })
        .eq('account_id', input.accountId).eq('id', input.eventId).is('processed_at', null);
      if (error) persistence();
    },
    async findReview(input) {
      const { data, error } = await client.from('partner_guest_reviews').select('*')
        .eq('partner_account_binding_id', input.partnerAccountBindingId).eq('source', input.source)
        .eq('external_review_id', input.externalReviewId).maybeSingle();
      if (error) persistence();
      return data as ReviewRow | null;
    },
    async insertReview(row) {
      const { data, error } = await client.from('partner_guest_reviews').insert(row).select('*').maybeSingle();
      if (error && !conflict(error)) persistence();
      return { row: data as ReviewRow | null, conflict: conflict(error) };
    },
    async insertSignal(row) {
      const { data, error } = await client.from('partner_reputation_signals').insert(row).select('*').maybeSingle();
      if (error && !conflict(error)) persistence();
      return { row: data as SignalRow | null, conflict: conflict(error) };
    },
    async listPropertyReviews(input) {
      const { data, error } = await client.from('partner_guest_reviews').select('*')
        .eq('account_id', input.accountId).eq('property_id', input.propertyId)
        .gte('received_at', input.since).order('received_at', { ascending: false }).limit(1000);
      if (error) persistence();
      return (data ?? []) as ReviewRow[];
    },
  };
}

function analyticsRow(row: ReviewRow): ReputationAnalyticsReview {
  return {
    reviewRef: row.public_review_ref,
    normalizedRating: Number(row.normalized_rating),
    sentiment: row.sentiment,
    recoveryContext: row.recovery_context,
    categories: row.categories,
    receivedAt: row.received_at,
  };
}

export function createPartnerReputationAnalytics(database: PartnerReputationDatabase) {
  return {
    async property(input: { accountId: string; propertyId: string; windowDays: 30 | 90; now?: Date }) {
      const now = input.now ?? new Date();
      const since = new Date(now.getTime() - input.windowDays * 86_400_000).toISOString();
      const rows = await database.listPropertyReviews({ accountId: input.accountId, propertyId: input.propertyId, since });
      return derivePropertyReputationIntelligence(rows.map(analyticsRow), input.windowDays);
    },
    async recoveryEffectiveness(input: { accountId: string; propertyId: string; windowDays: 30 | 90; now?: Date }) {
      const now = input.now ?? new Date();
      const since = new Date(now.getTime() - input.windowDays * 86_400_000).toISOString();
      const rows = await database.listPropertyReviews({ accountId: input.accountId, propertyId: input.propertyId, since });
      return deriveObservationalRecoveryReviewKpis(rows.map(analyticsRow));
    },
  };
}

const database = createSupabasePartnerReputationDatabase(supabase);
export const processPartnerReviewEvent = createPartnerReviewProcessor(database);
export const partnerReputationAnalytics = createPartnerReputationAnalytics(database);
