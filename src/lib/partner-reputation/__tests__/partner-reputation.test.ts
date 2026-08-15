import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import {
  PartnerAuthenticationError,
  type AuthenticatedPartnerPrincipal,
} from '@/lib/partner-communication/auth';
import { handlePartnerReputationEvent } from '@/app/api/partner/v1/reputation/events/route';
import {
  PartnerReputationContractError,
  validateTrustedPartnerReviewEvent,
} from '../contract';
import {
  classifyPartnerReview,
  deriveObservationalRecoveryReviewKpis,
  derivePropertyReputationIntelligence,
  recommendPartnerReviewResponse,
  responsePassesManipulationGuard,
  summarizeRecoveryFacts,
  type RecoveryFact,
  type ReputationAnalyticsReview,
} from '../policy';
import {
  PartnerReputationError,
  createPartnerReputationAnalytics,
  createPartnerReviewProcessor,
  type PartnerReputationDatabase,
} from '../repository';

const ACCOUNT_A = '10000000-0000-4000-8000-000000000001';
const ACCOUNT_B = '20000000-0000-4000-8000-000000000002';
const PROPERTY_A = '30000000-0000-4000-8000-000000000003';
const PROPERTY_B = '30000000-0000-4000-8000-000000000004';
const BOOKING_A = '40000000-0000-4000-8000-000000000005';
const BOOKING_B = '40000000-0000-4000-8000-000000000006';
const BINDING_A = '50000000-0000-4000-8000-000000000007';
const BINDING_B = '50000000-0000-4000-8000-000000000008';
const BOOKING_BINDING_A = '60000000-0000-4000-8000-000000000009';
const BOOKING_BINDING_B = '60000000-0000-4000-8000-000000000010';

function principal(account: 'a' | 'b' = 'a'): AuthenticatedPartnerPrincipal {
  return {
    accountId: account === 'a' ? ACCOUNT_A : ACCOUNT_B,
    partnerId: 'partner-demo',
    externalPartnerAccountId: account === 'a' ? 'external-account-a' : 'external-account-b',
    credentialId: `credential-${account}`,
    partnerAccountBindingId: account === 'a' ? BINDING_A : BINDING_B,
  } as unknown as AuthenticatedPartnerPrincipal;
}

function event(overrides: Record<string, unknown> = {}) {
  const review = {
    reviewId: 'review-1', source: 'apart-sharing-demo', rating: 5, ratingScale: 5,
    text: 'Все отлично, чисто и удобно.', language: 'ru', ...((overrides.review ?? {}) as object),
  };
  const rootOverrides = { ...overrides };
  delete rootOverrides.review;
  return {
    schemaVersion: 'partner.reputation.v1', eventId: 'event-1', eventType: 'review.received',
    occurredAt: '2026-08-15T12:00:00.000Z',
    partner: { partnerId: 'partner-demo', accountId: 'external-account-a' },
    property: { propertyId: 'external-property' }, booking: { bookingId: 'external-booking' },
    ...rootOverrides, review,
  };
}

function recovery(status: 'recovered' | 'unrecovered' | 'awaiting_guest_confirmation' = 'recovered'): RecoveryFact {
  return {
    category: 'maintenance', status,
    outcome: status === 'recovered' ? 'satisfied' : status === 'unrecovered' ? 'not_satisfied' : null,
    openedAt: '2026-08-14T10:00:00.000Z',
    operationResolvedAt: status === 'recovered' ? '2026-08-14T11:00:00.000Z' : null,
    guestConfirmedAt: status === 'recovered' || status === 'unrecovered' ? '2026-08-14T12:00:00.000Z' : null,
    resolutionLatencyMs: status === 'recovered' ? 3_600_000 : null,
    confirmationLatencyMs: status === 'recovered' ? 3_600_000 : null,
    totalRecoveryLatencyMs: status === 'recovered' ? 7_200_000 : null,
  };
}

type Memory = {
  events: Map<string, Record<string, unknown>>;
  reviews: Map<string, Record<string, unknown>>;
  signals: Map<string, Record<string, unknown>>;
  recoveryRows: Array<Record<string, unknown>>;
  recoveryQueries: Array<Record<string, unknown>>;
};

function fakeDatabase(): { database: PartnerReputationDatabase; memory: Memory } {
  const memory: Memory = { events: new Map(), reviews: new Map(), signals: new Map(), recoveryRows: [], recoveryQueries: [] };
  const database = {
    async findBindingScope(input: Record<string, string>) {
      const tenantB = input.accountId === ACCOUNT_B;
      return {
        partner_booking_binding_id: tenantB ? BOOKING_BINDING_B : BOOKING_BINDING_A,
        account_id: input.accountId,
        partner_account_binding_id: input.partnerAccountBindingId,
        external_property_id: input.externalPropertyId,
        external_booking_id: input.externalBookingId,
        property_id: tenantB ? PROPERTY_B : PROPERTY_A,
        booking_ops_record_id: tenantB ? BOOKING_B : BOOKING_A,
      };
    },
    async findRecoveryCases(input: Record<string, string>) {
      memory.recoveryQueries.push(input);
      return memory.recoveryRows.filter((row) => !row.account_id || row.account_id === input.accountId);
    },
    async findEvent(input: Record<string, string>) {
      return memory.events.get(`${input.accountId}|${input.partnerAccountBindingId}|${input.externalEventId}`) ?? null;
    },
    async insertEvent(row: Record<string, unknown>) {
      const key = `${row.account_id}|${row.partner_account_binding_id}|${row.external_event_id}`;
      if (memory.events.has(key)) return { row: null, conflict: true };
      memory.events.set(key, row);
      return { row, conflict: false };
    },
    async completeEvent(input: Record<string, unknown>) {
      const stored = [...memory.events.values()].find((row) => row.id === input.eventId);
      if (!stored) throw new Error('missing event');
      Object.assign(stored, { review_id: input.reviewId, response: input.response, processed_at: input.processedAt });
    },
    async failEvent(input: Record<string, unknown>) {
      const stored = [...memory.events.values()].find((row) => row.id === input.eventId);
      if (stored) Object.assign(stored, { error_code: input.errorCode, processed_at: input.processedAt });
    },
    async findReview(input: Record<string, string>) {
      return memory.reviews.get(`${input.partnerAccountBindingId}|${input.source}|${input.externalReviewId}`) ?? null;
    },
    async insertReview(row: Record<string, unknown>) {
      const key = `${row.partner_account_binding_id}|${row.source}|${row.external_review_id}`;
      if (memory.reviews.has(key)) return { row: null, conflict: true };
      memory.reviews.set(key, row);
      return { row, conflict: false };
    },
    async insertSignal(row: Record<string, unknown>) {
      const key = `${row.account_id}|${row.review_id}|${row.category}`;
      if (memory.signals.has(key)) return { row: null, conflict: true };
      memory.signals.set(key, row);
      return { row, conflict: false };
    },
    async listPropertyReviews(input: Record<string, string>) {
      return [...memory.reviews.values()].filter((row) => row.account_id === input.accountId && row.property_id === input.propertyId);
    },
  } as unknown as PartnerReputationDatabase;
  return { database, memory };
}

function processor(database: PartnerReputationDatabase) {
  return createPartnerReviewProcessor(database, {
    resolveCanonical: (async (partner: AuthenticatedPartnerPrincipal) => ({
      status: 'resolved', accountId: partner.accountId,
      propertyId: partner.accountId === ACCOUNT_A ? PROPERTY_A : PROPERTY_B,
      bookingId: partner.accountId === ACCOUNT_A ? BOOKING_A : BOOKING_B,
    })) as never,
  });
}

describe('Partner Review & Reputation Engine v1 contract and policy', () => {
  it('normalizes 8/10 and rejects invalid rating, impossible scale, malformed ID, and empty text', () => {
    expect(validateTrustedPartnerReviewEvent(event({ review: { reviewId: 'r-10', source: 'booking', rating: 8, ratingScale: 10, text: 'Хорошо' } })).review.normalizedRating).toBe(0.8);
    for (const review of [
      { reviewId: 'r', source: 'booking', rating: 0, ratingScale: 5, text: 'x' },
      { reviewId: 'r', source: 'booking', rating: 6, ratingScale: 5, text: 'x' },
      { reviewId: 'r', source: 'booking', rating: 1, ratingScale: 0, text: 'x' },
      { reviewId: 'bad id', source: 'booking', rating: 1, ratingScale: 5, text: 'x' },
      { reviewId: 'r', source: 'booking', rating: 1, ratingScale: 5, text: '   ' },
    ]) expect(() => validateTrustedPartnerReviewEvent(event({ review }))).toThrow(PartnerReputationContractError);
  });

  it('classifies synthetic A recovered heating review as positive, low risk, and truthful', () => {
    const context = validateTrustedPartnerReviewEvent(event({ review: {
      reviewId: 'scenario-a', source: 'apart-sharing-demo', rating: 5, ratingScale: 5,
      text: 'Сначала было холодно, но проблему быстро решили. Спасибо.',
    } }));
    const analysis = classifyPartnerReview(context, summarizeRecoveryFacts([recovery('recovered')]));
    const draft = recommendPartnerReviewResponse(analysis);
    expect(analysis).toMatchObject({ sentiment: 'positive', severity: 'low', reputationRisk: 'low', recoveryContext: 'recovered_before_review' });
    expect(analysis.categories).toEqual(expect.arrayContaining(['heating', 'maintenance']));
    expect(draft).toMatchObject({ policy: 'draft_safe' });
    expect(draft.text).toContain('удалось решить');
  });

  it('classifies synthetic B unrecovered review as negative/high and never claims resolution', () => {
    const context = validateTrustedPartnerReviewEvent(event({ review: {
      reviewId: 'scenario-b', source: 'partner-import', rating: 2, ratingScale: 5, text: 'Проблему так и не решили.',
    } }));
    const analysis = classifyPartnerReview(context, summarizeRecoveryFacts([recovery('unrecovered')]));
    const draft = recommendPartnerReviewResponse(analysis);
    expect(analysis).toMatchObject({ sentiment: 'negative', reputationRisk: 'high', recoveryContext: 'unrecovered_before_review' });
    expect(draft.policy).toBe('review_required');
    expect(draft.text).not.toMatch(/удалось решить|всё исправили/iu);
  });

  it('keeps a low-rating recovered review under human review despite confirmed recovery', () => {
    const context = validateTrustedPartnerReviewEvent(event({ review: {
      reviewId: 'recovered-low-rating', source: 'booking', rating: 2, ratingScale: 5,
      text: 'Проблему решили, но проживание было плохим.',
    } }));
    const analysis = classifyPartnerReview(context, summarizeRecoveryFacts([recovery('recovered')]));
    expect(analysis).toMatchObject({ sentiment: 'negative', reputationRisk: 'medium' });
    expect(recommendPartnerReviewResponse(analysis)).toMatchObject({
      policy: 'review_required', reasonCodes: ['negative_review', 'recovery_confirmed'],
    });
  });

  it('classifies synthetic C positive routine review without an operational alarm', () => {
    const context = validateTrustedPartnerReviewEvent(event());
    const analysis = classifyPartnerReview(context, summarizeRecoveryFacts([]));
    expect(analysis).toMatchObject({ sentiment: 'positive', severity: 'low', reputationRisk: 'low', recoveryContext: 'no_recovery_case' });
    expect(analysis.categories).toContain('cleanliness');
    expect(recommendPartnerReviewResponse(analysis)).toMatchObject({ policy: 'draft_safe', reasonCodes: ['routine_positive_review'] });
  });

  it('classifies synthetic D theft allegation as critical and human-reviewed without admission', () => {
    const context = validateTrustedPartnerReviewEvent(event({ review: {
      reviewId: 'scenario-d', source: 'avito', rating: 1, ratingScale: 5, text: 'У меня пропали вещи из квартиры.',
    } }));
    const analysis = classifyPartnerReview(context, summarizeRecoveryFacts([]));
    const draft = recommendPartnerReviewResponse(analysis);
    expect(analysis).toMatchObject({ sentiment: 'negative', severity: 'critical', reputationRisk: 'critical' });
    expect(analysis.categories).toContain('safety');
    expect(analysis.sensitiveAllegations).toContain('theft');
    expect(draft.policy).toBe('review_required');
    expect(draft.text).not.toMatch(/винов|ответствен|украл/iu);
  });

  it('keeps a terse 1/5 review negative without keyword detail', () => {
    const context = validateTrustedPartnerReviewEvent(event({ review: { reviewId: 'terse', source: 'booking', rating: 1, ratingScale: 5, text: 'Ужасно' } }));
    expect(classifyPartnerReview(context, summarizeRecoveryFacts([]))).toMatchObject({ sentiment: 'negative', reputationRisk: 'high' });
  });

  it('forbids manipulation, refund/compensation promises, pressure, and review gating', () => {
    for (const unsafe of [
      'Удалите негативный отзыв.', 'Измените оценку.', 'Поставьте 5 звезд.',
      'Скидка в обмен на изменение отзыва.', 'Если удалите отзыв, обещаем возврат.',
      'Гарантируем компенсацию.',
    ]) expect(responsePassesManipulationGuard(unsafe)).toBe(false);
    const safe = recommendPartnerReviewResponse(classifyPartnerReview(validateTrustedPartnerReviewEvent(event()), summarizeRecoveryFacts([])));
    expect(responsePassesManipulationGuard(safe.text)).toBe(true);
    expect(safe.text).not.toMatch(/возврат|компенсац/iu);
  });

  it('summarizes multiple cases without claiming sentence-level causation', () => {
    const summary = summarizeRecoveryFacts([recovery('recovered'), recovery('unrecovered')]);
    expect(summary.context).toBe('multiple_recovery_cases');
    expect(summary.facts).toHaveLength(2);
    const analysis = classifyPartnerReview(validateTrustedPartnerReviewEvent(event()), summary);
    expect(analysis.reputationRisk).toBe('medium');
    expect(recommendPartnerReviewResponse(analysis)).toMatchObject({
      policy: 'review_required', reasonCodes: ['multiple_recovery_cases'],
    });
  });
});

describe('Partner reputation authenticated HTTP boundary', () => {
  it('accepts the strict event through authenticated processing and rejects missing credentials safely', async () => {
    const { database } = fakeDatabase();
    const request = () => new Request('http://localhost/api/partner/v1/reputation/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event()),
    });
    const accepted = await handlePartnerReputationEvent(request(), {
      authenticate: async () => principal(),
      process: processor(database),
    });
    expect(accepted.status).toBe(202);
    expect(await accepted.json()).toMatchObject({ accepted: true, duplicate: false });

    const rejected = await handlePartnerReputationEvent(request(), {
      authenticate: async () => { throw new PartnerAuthenticationError(); },
      process: processor(database),
    });
    expect(rejected.status).toBe(401);
    expect(await rejected.json()).toEqual({ ok: false, error: 'partner_authentication_failed' });
  });
});

describe('Partner Review & Reputation Engine v1 persistence behavior', () => {
  it('ingests a valid review and returns only opaque/safe partner data', async () => {
    const { database, memory } = fakeDatabase();
    const result = await processor(database)(principal(), validateTrustedPartnerReviewEvent(event()));
    expect(result).toMatchObject({ accepted: true, duplicate: false, review: { source: 'apart-sharing-demo', normalizedRating: 1 } });
    expect(result.review.reviewRef).toMatch(/^prev_[A-Za-z0-9_-]{32,96}$/);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(ACCOUNT_A);
    expect(serialized).not.toContain(PROPERTY_A);
    expect(serialized).not.toContain(BOOKING_A);
    expect(memory.reviews.size).toBe(1);
    expect(memory.signals.size).toBe(0);
  });

  it('returns the same stored review, analysis, and draft on exact event replay', async () => {
    const { database, memory } = fakeDatabase();
    const process = processor(database);
    const context = validateTrustedPartnerReviewEvent(event());
    const first = await process(principal(), context);
    const replay = await process(principal(), context);
    expect(replay).toEqual({ ...first, duplicate: true });
    expect(memory.reviews.size).toBe(1);
    expect(memory.signals.size).toBe(0);
  });

  it('fails changed content under the same event ID with partner_event_conflict', async () => {
    const { database } = fakeDatabase();
    const process = processor(database);
    await process(principal(), validateTrustedPartnerReviewEvent(event()));
    await expect(process(principal(), validateTrustedPartnerReviewEvent(event({ review: {
      reviewId: 'review-1', source: 'apart-sharing-demo', rating: 4, ratingScale: 5, text: 'Changed',
    } })))).rejects.toMatchObject({ code: 'partner_event_conflict' });
  });

  it('fails conflicting content for the same external review ID without creating a second review', async () => {
    const { database, memory } = fakeDatabase();
    const process = processor(database);
    await process(principal(), validateTrustedPartnerReviewEvent(event()));
    await expect(process(principal(), validateTrustedPartnerReviewEvent(event({ eventId: 'event-2', review: {
      reviewId: 'review-1', source: 'apart-sharing-demo', rating: 1, ratingScale: 5, text: 'Ужасно',
    } })))).rejects.toMatchObject({ code: 'partner_review_conflict' });
    expect(memory.reviews.size).toBe(1);
  });

  it('isolates the same external review ID across tenants', async () => {
    const { database, memory } = fakeDatabase();
    const process = processor(database);
    await process(principal(), validateTrustedPartnerReviewEvent(event()));
    const tenantBEvent = event({
      eventId: 'event-b',
      partner: { partnerId: 'partner-demo', accountId: 'external-account-b' },
      review: { reviewId: 'review-1', source: 'apart-sharing-demo', rating: 2, ratingScale: 5, text: 'Плохо' },
    });
    await process(principal('b'), validateTrustedPartnerReviewEvent(tenantBEvent));
    expect(memory.reviews.size).toBe(2);
  });

  it('correlates recovery only with exact authenticated tenant/property/booking query', async () => {
    const { database, memory } = fakeDatabase();
    memory.recoveryRows = [{
      category: 'maintenance', outcome: 'satisfied', status: 'recovered', opened_at: '2026-08-14T10:00:00.000Z',
      operation_resolved_at: '2026-08-14T11:00:00.000Z', guest_confirmed_at: '2026-08-14T12:00:00.000Z',
    }];
    const result = await processor(database)(principal(), validateTrustedPartnerReviewEvent(event({ review: {
      reviewId: 'recovered', source: 'booking', rating: 5, ratingScale: 5,
      text: 'Сначала было холодно, но проблему быстро решили. Спасибо.',
    } })));
    expect(result.analysis.recoveryContext).toBe('recovered_before_review');
    expect(memory.recoveryQueries).toEqual([expect.objectContaining({
      accountId: ACCOUNT_A, partnerId: 'partner-demo', externalPartnerAccountId: 'external-account-a',
      externalPropertyId: 'external-property', externalBookingId: 'external-booking',
    })]);
  });

  it("does not observe another tenant's recovery case", async () => {
    const { database, memory } = fakeDatabase();
    memory.recoveryRows = [{
      account_id: ACCOUNT_B,
      category: 'maintenance', outcome: 'not_satisfied', status: 'unrecovered',
      opened_at: '2026-08-14T10:00:00.000Z', operation_resolved_at: null,
      guest_confirmed_at: '2026-08-14T12:00:00.000Z',
    }];
    const result = await processor(database)(principal(), validateTrustedPartnerReviewEvent(event({
      review: { reviewId: 'tenant-recovery', source: 'booking', rating: 5, ratingScale: 5, text: 'Все отлично.' },
    })));
    expect(result.analysis.recoveryContext).toBe('no_recovery_case');
    expect(result.analysis.recoveryFacts).toEqual([]);
  });

  it('keeps root-cause signals idempotent across a second event for identical review content', async () => {
    const { database, memory } = fakeDatabase();
    memory.recoveryRows = [{ category: 'maintenance', outcome: 'not_satisfied', status: 'unrecovered', opened_at: '2026-08-14T10:00:00.000Z', operation_resolved_at: null, guest_confirmed_at: '2026-08-14T12:00:00.000Z' }];
    const process = processor(database);
    const firstInput = event({ review: { reviewId: 'signal-review', source: 'booking', rating: 2, ratingScale: 5, text: 'Отопление не работает.' } });
    await process(principal(), validateTrustedPartnerReviewEvent(firstInput));
    await process(principal(), validateTrustedPartnerReviewEvent({ ...firstInput, eventId: 'event-2' }));
    expect(memory.reviews.size).toBe(1);
    expect([...memory.signals.values()].map((row) => row.category).sort()).toEqual(['heating', 'maintenance']);
  });

  it('fails closed when canonical scope and binding scope differ', async () => {
    const { database } = fakeDatabase();
    const original = database.findBindingScope;
    database.findBindingScope = async (input) => ({ ...(await original(input))!, property_id: PROPERTY_B });
    await expect(processor(database)(principal(), validateTrustedPartnerReviewEvent(event())))
      .rejects.toBeInstanceOf(PartnerReputationError);
  });
});

describe('Partner reputation aggregation and observational KPI foundation', () => {
  const row = (overrides: Partial<ReputationAnalyticsReview> = {}): ReputationAnalyticsReview => ({
    reviewRef: `prev_${'x'.repeat(32)}`, normalizedRating: 1, sentiment: 'positive',
    recoveryContext: 'no_recovery_case', categories: ['cleanliness'], receivedAt: '2026-08-15T00:00:00.000Z', ...overrides,
  });

  it('aggregates recurring property issues at the explicit four-review threshold', () => {
    const result = derivePropertyReputationIntelligence([
      row({ categories: ['heating'] }), row({ categories: ['heating'] }),
      row({ categories: ['heating'] }), row({ categories: ['heating'], sentiment: 'negative', normalizedRating: 0.2 }),
    ], 30);
    expect(result).toMatchObject({ reviewCount: 4, negativeReviewCount: 1, negativeReviewRate: 0.25 });
    expect(result.recurringIssues).toEqual([{ category: 'heating', count: 4 }]);
  });

  it('does not make a trend claim from a small sample', () => {
    const result = derivePropertyReputationIntelligence([row(), row({ sentiment: 'negative', normalizedRating: 0.2 })], 90);
    expect(result.trendSignal).toBe('insufficient_sample');
  });

  it('returns observational recovered/unrecovered cohorts only when samples exist', () => {
    const result = deriveObservationalRecoveryReviewKpis([
      row({ recoveryContext: 'recovered_before_review', normalizedRating: 1 }),
      row({ recoveryContext: 'recovered_before_review', normalizedRating: 0.8 }),
      row({ recoveryContext: 'unrecovered_before_review', sentiment: 'negative', normalizedRating: 0.2 }),
    ]);
    expect(result).toEqual({
      label: 'observational', causalityClaimed: false,
      recovered: { sampleSize: 2, negativeReviewRate: 0, averageNormalizedRating: 0.9 },
      unrecovered: { sampleSize: 1, negativeReviewRate: 1, averageNormalizedRating: 0.2 },
    });
    expect(deriveObservationalRecoveryReviewKpis([]).recovered.averageNormalizedRating).toBeNull();
  });

  it('scopes stored aggregation by tenant and property before deriving intelligence', async () => {
    const { database, memory } = fakeDatabase();
    memory.reviews.set('a', {
      account_id: ACCOUNT_A, property_id: PROPERTY_A, public_review_ref: `prev_${'a'.repeat(32)}`,
      normalized_rating: 0.2, sentiment: 'negative', recovery_context: 'unrecovered_before_review',
      categories: ['heating'], received_at: '2026-08-15T00:00:00.000Z',
    });
    memory.reviews.set('b', {
      account_id: ACCOUNT_B, property_id: PROPERTY_B, public_review_ref: `prev_${'b'.repeat(32)}`,
      normalized_rating: 1, sentiment: 'positive', recovery_context: 'recovered_before_review',
      categories: ['cleanliness'], received_at: '2026-08-15T00:00:00.000Z',
    });
    const result = await createPartnerReputationAnalytics(database).property({
      accountId: ACCOUNT_A, propertyId: PROPERTY_A, windowDays: 30,
      now: new Date('2026-08-16T00:00:00.000Z'),
    });
    expect(result).toMatchObject({ reviewCount: 1, negativeReviewCount: 1, averageNormalizedRating: 0.2 });
    expect(result.categoryCounts).toEqual({ heating: 1 });
  });
});
