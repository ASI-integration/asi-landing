export const PARTNER_REVENUE_SCHEMA_VERSION = 'partner.revenue.v1' as const;
export const PARTNER_REVENUE_EVENT_TYPES = [
  'revenue.observation.recorded',
  'pricing.shadow.requested',
  'pricing.recommendation.feedback',
] as const;
export type PartnerRevenueEventType = (typeof PARTNER_REVENUE_EVENT_TYPES)[number];
export type FeedbackStatus = 'accepted' | 'rejected' | 'ignored';

export type RevenueIdentity = Readonly<{
  eventId: string;
  partnerId: string;
  accountId: string;
  propertyId: string;
}>;
export type NightlyRevenueObservation = Readonly<{
  stayDate: string;
  currentPrice: number;
  availableInventory: number;
  soldInventory: number;
  realizedRoomRevenue: number;
  bookingLeadDays: number | null;
  bookingsCreated: number | null;
  cancellations: number | null;
  minStay: number | null;
  closedToArrival: boolean | null;
  currency: string;
  source: 'partner_supplied' | 'synthetic_demo';
}>;
type BaseEvent = Readonly<{
  schemaVersion: typeof PARTNER_REVENUE_SCHEMA_VERSION;
  eventId: string;
  occurredAt: string;
  eventType: PartnerRevenueEventType;
  partner: Readonly<{ partnerId: string; accountId: string }>;
  property: Readonly<{ propertyId: string }>;
}>;
export type PartnerRevenueEvent =
  | (BaseEvent & Readonly<{ eventType: 'revenue.observation.recorded'; observation: NightlyRevenueObservation }>)
  | (BaseEvent & Readonly<{ eventType: 'pricing.shadow.requested'; request: Readonly<{ stayDates: readonly string[] }> }>)
  | (BaseEvent & Readonly<{ eventType: 'pricing.recommendation.feedback'; feedback: Readonly<{ recommendationRef: string; status: FeedbackStatus; reasonCode: string | null }> }>);

export class PartnerRevenueContractError extends Error {
  constructor(readonly code: 'partner_contract_invalid' | 'partner_payload_too_large') {
    super(code);
    this.name = 'PartnerRevenueContractError';
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const CURRENCY = /^[A-Z]{3}$/u;
const RECOMMENDATION_REF = /^prc_[A-Za-z0-9_-]{32,96}$/u;
const REASON = /^[a-z0-9_:-]{1,80}$/u;
const MAX_BYTES = 32_768;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) fail();
}
function string(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}
function iso(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail();
  return new Date(value).toISOString();
}
function date(value: unknown): string {
  const result = string(value, DATE);
  if (new Date(`${result}T00:00:00Z`).toISOString().slice(0, 10) !== result) fail();
  return result;
}
function number(value: unknown, max = 1_000_000_000): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) fail();
  return value;
}
function integer(value: unknown, max: number): number {
  const result = number(value, max);
  if (!Number.isInteger(result)) fail();
  return result;
}
function optionalInteger(value: unknown, max: number): number | null {
  return value == null ? null : integer(value, max);
}
function fail(): never { throw new PartnerRevenueContractError('partner_contract_invalid'); }

export function validatePartnerRevenueEvent(input: unknown): PartnerRevenueEvent {
  if (Buffer.byteLength(JSON.stringify(input ?? null), 'utf8') > MAX_BYTES) {
    throw new PartnerRevenueContractError('partner_payload_too_large');
  }
  const root = record(input);
  const eventType = string(root.eventType, /^(revenue\.observation\.recorded|pricing\.shadow\.requested|pricing\.recommendation\.feedback)$/u) as PartnerRevenueEventType;
  exact(root, ['schemaVersion', 'eventId', 'eventType', 'occurredAt', 'partner', 'property', eventType === 'revenue.observation.recorded' ? 'observation' : eventType === 'pricing.shadow.requested' ? 'request' : 'feedback']);
  if (root.schemaVersion !== PARTNER_REVENUE_SCHEMA_VERSION) fail();
  const partner = record(root.partner); exact(partner, ['partnerId', 'accountId']);
  const property = record(root.property); exact(property, ['propertyId']);
  const base = {
    schemaVersion: PARTNER_REVENUE_SCHEMA_VERSION,
    eventId: string(root.eventId, ID),
    eventType,
    occurredAt: iso(root.occurredAt),
    partner: { partnerId: string(partner.partnerId, ID), accountId: string(partner.accountId, ID) },
    property: { propertyId: string(property.propertyId, ID) },
  };
  if (eventType === 'revenue.observation.recorded') {
    const value = record(root.observation);
    exact(value, ['stayDate', 'currentPrice', 'availableInventory', 'soldInventory', 'realizedRoomRevenue', 'bookingLeadDays', 'bookingsCreated', 'cancellations', 'minStay', 'closedToArrival', 'currency']);
    const availableInventory = integer(value.availableInventory, 100_000);
    const soldInventory = integer(value.soldInventory, 100_000);
    if (soldInventory > availableInventory) fail();
    if (value.closedToArrival != null && typeof value.closedToArrival !== 'boolean') fail();
    const minStay = optionalInteger(value.minStay, 3650);
    if (minStay != null && minStay < 1) fail();
    return Object.freeze({ ...base, eventType, observation: Object.freeze({
      stayDate: date(value.stayDate), currentPrice: number(value.currentPrice), availableInventory,
      soldInventory, realizedRoomRevenue: number(value.realizedRoomRevenue),
      bookingLeadDays: optionalInteger(value.bookingLeadDays, 3650),
      bookingsCreated: optionalInteger(value.bookingsCreated, 100_000),
      cancellations: optionalInteger(value.cancellations, 100_000),
      minStay,
      closedToArrival: value.closedToArrival == null ? null : value.closedToArrival,
      currency: string(value.currency, CURRENCY), source: 'partner_supplied',
    }) });
  }
  if (eventType === 'pricing.shadow.requested') {
    const value = record(root.request); exact(value, ['stayDates']);
    if (!Array.isArray(value.stayDates) || value.stayDates.length < 1 || value.stayDates.length > 90) fail();
    const stayDates = [...new Set(value.stayDates.map(date))];
    if (stayDates.length !== value.stayDates.length) fail();
    return Object.freeze({ ...base, eventType, request: Object.freeze({ stayDates: Object.freeze(stayDates) }) });
  }
  const value = record(root.feedback); exact(value, ['recommendationRef', 'status', 'reasonCode']);
  if (!['accepted', 'rejected', 'ignored'].includes(String(value.status))) fail();
  const reasonCode = value.reasonCode == null ? null : string(value.reasonCode, REASON);
  return Object.freeze({ ...base, eventType, feedback: Object.freeze({
    recommendationRef: string(value.recommendationRef, RECOMMENDATION_REF),
    status: value.status as FeedbackStatus, reasonCode,
  }) });
}

export const SYNTHETIC_APARTMENT_101_OBSERVATIONS = Object.freeze(Array.from({ length: 75 }, (_, index): NightlyRevenueObservation => {
  const start = new Date('2026-03-01T00:00:00Z'); start.setUTCDate(start.getUTCDate() + index);
  const weekend = [0, 5, 6].includes(start.getUTCDay());
  const highDemand = index >= 38 && index <= 49;
  const lowDemand = index < 14;
  const availableInventory = index % 19 === 0 ? 0 : 1;
  const soldInventory = availableInventory && (highDemand || (!lowDemand && index % 4 !== 0) || (weekend && index % 3 !== 0)) ? 1 : 0;
  const currentPrice = 4800 + (weekend ? 700 : 0) + (highDemand ? 900 : 0) - (lowDemand ? 500 : 0);
  return Object.freeze({
    stayDate: start.toISOString().slice(0, 10), currentPrice, availableInventory, soldInventory,
    realizedRoomRevenue: soldInventory ? currentPrice : 0,
    bookingLeadDays: index % 8 === 0 ? null : 4 + index % 42,
    bookingsCreated: index % 9 === 0 ? null : soldInventory,
    cancellations: index % 13 === 0 ? null : index % 17 === 0 ? 1 : 0,
    minStay: weekend ? 2 : 1, closedToArrival: index % 23 === 0, currency: 'RUB', source: 'synthetic_demo',
  });
}));
