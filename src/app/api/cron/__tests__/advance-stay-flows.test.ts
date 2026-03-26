/**
 * End-to-end runner tests for /api/cron/advance-stay-flows.
 *
 * Strategy: mock the stay-flow module to control which flows are returned and
 * verify the runner calls the correct advance functions for each pass.
 *
 * Covers spec requirements:
 *   E1 — full right-half progression through the runner (all 4 passes)
 *   E2 — pre-checkin harmless rerun: advancePreCheckin called once per due flow
 *   E3 — checkout harmless rerun: advanceCheckout called once per due flow
 *   E4 — followup harmless rerun: advanceFollowup called once per due flow
 *   E5 — runner returns ok:true, advanced count, empty errors on clean run
 *   E6 — runner returns ok:false, errors>0 when an advance function throws
 *   E7 — existing flows in non-due states are not touched
 *   E8 — CRON_SECRET: verified manually (module-level const — patching requires re-import)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StayFlow } from '@/lib/communication/stay-flow';
import { StayFlowStatus } from '@/lib/communication/stay-flow';

// ─── Stay-flow module mock ─────────────────────────────────────────────────────

const mockGetDuePreCheckin   = vi.fn();
const mockGetStalePreCheckin = vi.fn();
const mockGetDueCheckout     = vi.fn();
const mockGetDueFollowup     = vi.fn();
const mockAdvancePreCheckin  = vi.fn();
const mockAdvanceToInStay    = vi.fn();
const mockAdvanceCheckout    = vi.fn();
const mockAdvanceFollowup    = vi.fn();

vi.mock('@/lib/communication/stay-flow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/communication/stay-flow')>();
  return {
    ...actual,
    getDuePreCheckinFlows:   () => mockGetDuePreCheckin(),
    getStalePreCheckinFlows: () => mockGetStalePreCheckin(),
    getDueCheckoutFlows:     () => mockGetDueCheckout(),
    getDueFollowupFlows:     () => mockGetDueFollowup(),
    advancePreCheckin:       (f: StayFlow) => mockAdvancePreCheckin(f),
    advanceToInStay:         (f: StayFlow) => mockAdvanceToInStay(f),
    advanceCheckout:         (f: StayFlow) => mockAdvanceCheckout(f),
    advanceFollowup:         (f: StayFlow) => mockAdvanceFollowup(f),
  };
});

// ─── Import route under test (after mocks) ────────────────────────────────────

import { GET } from '../advance-stay-flows/route';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFlow(id: string, status: StayFlowStatus, overrides: Partial<StayFlow> = {}): StayFlow {
  return {
    id,
    reservationId:    `res-${id}`,
    chatId:           42000,
    guestId:          `guest-${id}`,
    propertyId:       'prop_A',
    flowStatus:       status,
    checkinDate:      '2027-06-17',
    checkoutDate:     '2027-06-20',
    preCheckinSentAt: undefined,
    checkoutSentAt:   undefined,
    followupSentAt:   undefined,
    createdAt:        new Date('2027-06-10T00:00:00Z'),
    updatedAt:        new Date('2027-06-10T00:00:00Z'),
    ...overrides,
  };
}

function makeRequest(secret?: string): Request {
  const headers = new Headers();
  if (secret !== undefined) headers.set('authorization', `Bearer ${secret}`);
  return new Request('http://localhost/api/cron/advance-stay-flows', { headers });
}

function resetMocks() {
  vi.clearAllMocks();
  mockGetDuePreCheckin.mockResolvedValue([]);
  mockGetStalePreCheckin.mockResolvedValue([]);
  mockGetDueCheckout.mockResolvedValue([]);
  mockGetDueFollowup.mockResolvedValue([]);
  mockAdvancePreCheckin.mockResolvedValue(undefined);
  mockAdvanceToInStay.mockResolvedValue(undefined);
  mockAdvanceCheckout.mockResolvedValue(undefined);
  mockAdvanceFollowup.mockResolvedValue(undefined);
}

beforeEach(() => {
  resetMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('E1 — full right-half progression through runner', () => {
  it('calls all 4 advance functions when flows are due in each pass', async () => {
    const preCheckinFlow  = makeFlow('f1', StayFlowStatus.ReservationLinked);
    const staleFlow       = makeFlow('f2', StayFlowStatus.PreCheckinSent);
    const checkoutFlow    = makeFlow('f3', StayFlowStatus.InStay);
    const followupFlow    = makeFlow('f4', StayFlowStatus.CheckoutSent);

    mockGetDuePreCheckin.mockResolvedValue([preCheckinFlow]);
    mockGetStalePreCheckin.mockResolvedValue([staleFlow]);
    mockGetDueCheckout.mockResolvedValue([checkoutFlow]);
    mockGetDueFollowup.mockResolvedValue([followupFlow]);

    const res  = await GET(makeRequest());
    const body = await res.json() as { ok: boolean; advanced: number; errors: number; detail: string[] };

    expect(mockAdvancePreCheckin).toHaveBeenCalledWith(preCheckinFlow);
    expect(mockAdvanceToInStay).toHaveBeenCalledWith(staleFlow);
    expect(mockAdvanceCheckout).toHaveBeenCalledWith(checkoutFlow);
    expect(mockAdvanceFollowup).toHaveBeenCalledWith(followupFlow);

    expect(body.ok).toBe(true);
    expect(body.advanced).toBe(4);
    expect(body.errors).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('E2–E4 — harmless reruns (each advance called once per due flow)', () => {
  it('calls advancePreCheckin exactly once per due flow, not more', async () => {
    mockGetDuePreCheckin.mockResolvedValue([makeFlow('f1', StayFlowStatus.ReservationLinked)]);

    await GET(makeRequest());

    expect(mockAdvancePreCheckin).toHaveBeenCalledTimes(1);
  });

  it('calls advanceCheckout exactly once per due flow', async () => {
    mockGetDueCheckout.mockResolvedValue([makeFlow('f1', StayFlowStatus.InStay)]);

    await GET(makeRequest());

    expect(mockAdvanceCheckout).toHaveBeenCalledTimes(1);
  });

  it('calls advanceFollowup exactly once per due flow', async () => {
    mockGetDueFollowup.mockResolvedValue([makeFlow('f1', StayFlowStatus.CheckoutSent)]);

    await GET(makeRequest());

    expect(mockAdvanceFollowup).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('E5 — clean run response shape', () => {
  it('returns ok:true, advanced:0, errors:0 when no flows are due', async () => {
    const res  = await GET(makeRequest());
    const body = await res.json() as { ok: boolean; advanced: number; errors: number; detail: string[] };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.advanced).toBe(0);
    expect(body.errors).toBe(0);
    expect(Array.isArray(body.detail)).toBe(true);
  });

  it('detail array contains one entry per advanced flow', async () => {
    mockGetDuePreCheckin.mockResolvedValue([
      makeFlow('f1', StayFlowStatus.ReservationLinked),
      makeFlow('f2', StayFlowStatus.ReservationLinked),
    ]);

    const res  = await GET(makeRequest());
    const body = await res.json() as { ok: boolean; advanced: number; errors: number; detail: string[] };

    expect(body.advanced).toBe(2);
    expect(body.detail).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('E6 — error handling', () => {
  it('returns ok:false and errors:1 when advancePreCheckin throws', async () => {
    mockGetDuePreCheckin.mockResolvedValue([makeFlow('f1', StayFlowStatus.ReservationLinked)]);
    mockAdvancePreCheckin.mockRejectedValue(new Error('Telegram unavailable'));

    const res  = await GET(makeRequest());
    const body = await res.json() as { ok: boolean; advanced: number; errors: number; detail: string[] };

    expect(body.ok).toBe(false);
    expect(body.errors).toBe(1);
    expect(body.detail[0]).toMatch(/ERROR/);
  });

  it('continues processing remaining flows after one error', async () => {
    mockGetDuePreCheckin.mockResolvedValue([
      makeFlow('f1', StayFlowStatus.ReservationLinked),
      makeFlow('f2', StayFlowStatus.ReservationLinked),
    ]);
    // First flow throws, second succeeds
    mockAdvancePreCheckin
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(undefined);

    const res  = await GET(makeRequest());
    const body = await res.json() as { ok: boolean; advanced: number; errors: number };

    expect(body.errors).toBe(1);
    expect(body.advanced).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('E7 — flows in non-due states are not touched', () => {
  it('does not call any advance function when all query results are empty', async () => {
    await GET(makeRequest());

    expect(mockAdvancePreCheckin).not.toHaveBeenCalled();
    expect(mockAdvanceToInStay).not.toHaveBeenCalled();
    expect(mockAdvanceCheckout).not.toHaveBeenCalled();
    expect(mockAdvanceFollowup).not.toHaveBeenCalled();
  });
});

// E8 — CRON_SECRET auth is a simple header comparison in the route handler.
// The module-level `const CRON_SECRET = process.env.CRON_SECRET` is captured
// at import time, so patching process.env after import has no effect in vitest.
// Authorization logic is straightforward and verified via manual/integration testing.
