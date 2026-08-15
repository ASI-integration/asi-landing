import 'server-only';

export const PARTNER_REPUTATION_SCHEMA_VERSION = 'partner.reputation.v1' as const;
export const PARTNER_REPUTATION_EVENT_TYPE = 'review.received' as const;

export type PartnerReviewSource = string;
export type PartnerReviewSentiment = 'positive' | 'mixed' | 'negative';
export type PartnerReviewSeverity = 'low' | 'medium' | 'high' | 'critical';
export type PartnerReputationRisk = 'low' | 'medium' | 'high' | 'critical';
export type PartnerReviewResponsePolicy = 'draft_safe' | 'review_required' | 'blocked';
export type PartnerRecoveryContext =
  | 'no_recovery_case'
  | 'recovered_before_review'
  | 'unrecovered_before_review'
  | 'awaiting_guest_confirmation'
  | 'multiple_recovery_cases';

export const PARTNER_REPUTATION_CATEGORIES = [
  'cleanliness', 'maintenance', 'heating', 'water', 'access', 'checkin', 'checkout',
  'communication', 'noise', 'wifi', 'parking', 'amenities', 'accuracy', 'value',
  'safety', 'payment', 'staff', 'other',
] as const;
export type PartnerReputationCategory = (typeof PARTNER_REPUTATION_CATEGORIES)[number];

export type PartnerReviewReceivedEventV1 = {
  schemaVersion: typeof PARTNER_REPUTATION_SCHEMA_VERSION;
  eventId: string;
  eventType: typeof PARTNER_REPUTATION_EVENT_TYPE;
  occurredAt: string;
  partner: { partnerId: string; accountId: string };
  property: { propertyId: string };
  booking: { bookingId: string };
  review: {
    reviewId: string;
    source: PartnerReviewSource;
    rating: number;
    ratingScale: number;
    title: string | null;
    text: string;
    language: string | null;
    publishedAt: string | null;
  };
};

export type TrustedPartnerReviewContext = Readonly<{
  schemaVersion: typeof PARTNER_REPUTATION_SCHEMA_VERSION;
  eventType: typeof PARTNER_REPUTATION_EVENT_TYPE;
  occurredAt: string;
  identity: Readonly<{
    eventId: string;
    partnerId: string;
    accountId: string;
    propertyId: string;
    bookingId: string;
  }>;
  review: Readonly<PartnerReviewReceivedEventV1['review'] & { normalizedRating: number }>;
}>;

export class PartnerReputationContractError extends Error {
  constructor(readonly code:
    | 'partner_contract_invalid'
    | 'partner_schema_version_unsupported'
    | 'partner_event_type_unsupported'
    | 'partner_review_invalid') {
    super(code);
    this.name = 'PartnerReputationContractError';
  }
}

const ID_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._:@/+\-]{0,199}$/u;
const SOURCE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
type JsonObject = Record<string, unknown>;

function fail(code: PartnerReputationContractError['code'] = 'partner_contract_invalid'): never {
  throw new PartnerReputationContractError(code);
}

function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  return value as JsonObject;
}

function exact(value: JsonObject, fields: readonly string[]): void {
  if (Object.keys(value).some((field) => !fields.includes(field))) fail();
}

function identifier(value: unknown): string {
  if (typeof value !== 'string') fail();
  const normalized = value.trim();
  if (!ID_PATTERN.test(normalized)) fail();
  return normalized;
}

function optionalText(value: unknown, maximum: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') fail('partner_review_invalid');
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) fail('partner_review_invalid');
  return normalized;
}

function timestamp(value: unknown, optional = false): string | null {
  if (optional && (value === undefined || value === null)) return null;
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed)) fail();
  return new Date(parsed).toISOString();
}

function finiteRating(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail('partner_review_invalid');
  return value;
}

export function validateTrustedPartnerReviewEvent(input: unknown): TrustedPartnerReviewContext {
  const root = object(input);
  exact(root, ['schemaVersion', 'eventId', 'eventType', 'occurredAt', 'partner', 'property', 'booking', 'review']);
  if (root.schemaVersion !== PARTNER_REPUTATION_SCHEMA_VERSION) fail('partner_schema_version_unsupported');
  if (root.eventType !== PARTNER_REPUTATION_EVENT_TYPE) fail('partner_event_type_unsupported');

  const partner = object(root.partner); exact(partner, ['partnerId', 'accountId']);
  const property = object(root.property); exact(property, ['propertyId']);
  const booking = object(root.booking); exact(booking, ['bookingId']);
  const review = object(root.review);
  exact(review, ['reviewId', 'source', 'rating', 'ratingScale', 'title', 'text', 'language', 'publishedAt']);

  const source = typeof review.source === 'string' ? review.source.trim().toLowerCase() : '';
  const rating = finiteRating(review.rating);
  const ratingScale = finiteRating(review.ratingScale);
  if (!SOURCE_PATTERN.test(source) || rating <= 0 || ratingScale < 1 || ratingScale > 100 || rating > ratingScale) {
    fail('partner_review_invalid');
  }
  const reviewText = optionalText(review.text, 4096);
  if (!reviewText) fail('partner_review_invalid');
  const language = optionalText(review.language, 35);
  if (language && !LANGUAGE_PATTERN.test(language)) fail('partner_review_invalid');

  return Object.freeze({
    schemaVersion: PARTNER_REPUTATION_SCHEMA_VERSION,
    eventType: PARTNER_REPUTATION_EVENT_TYPE,
    occurredAt: timestamp(root.occurredAt) as string,
    identity: Object.freeze({
      eventId: identifier(root.eventId),
      partnerId: identifier(partner.partnerId),
      accountId: identifier(partner.accountId),
      propertyId: identifier(property.propertyId),
      bookingId: identifier(booking.bookingId),
    }),
    review: Object.freeze({
      reviewId: identifier(review.reviewId),
      source,
      rating,
      ratingScale,
      normalizedRating: Number((rating / ratingScale).toFixed(6)),
      title: optionalText(review.title, 300),
      text: reviewText,
      language,
      publishedAt: timestamp(review.publishedAt, true),
    }),
  });
}
