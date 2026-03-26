/**
 * Recovery tests for recoverMissingStayFlows.
 *
 * R1 — missing stay_flow: creates it (recovered:1, skipped:0, errors:0)
 * R2 — stay_flow already exists: skips without writing (recovered:0, skipped:1)
 * R3 — harmless retry (idempotent): second call returns skipped:1, no duplicate row
 * R4 — reservation row missing: errors:1
 * R5 — scoped by chatId: only processes the target chat
 * R6 — supabase inquiry query error: returns ok:false
 * R7 — upsertStayFlow returns null: counted as error
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Shared mock state ─────────────────────────────────────────────────────────

const mockUpsertStayFlow       = vi.fn();
const mockGetStayByReservationId = vi.fn();

vi.mock('../stay-flow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../stay-flow')>();
  return {
    ...actual,
    upsertStayFlow:             (...args: unknown[]) => mockUpsertStayFlow(...args),
    getStayFlowByReservationId: (...args: unknown[]) => mockGetStayByReservationId(...args),
  };
});

// ─── Supabase mock ─────────────────────────────────────────────────────────────
//
// Two separate query chains are needed:
//   tg_inquiry_flows  — filter chain awaited directly (thenable)
//   tg_guest_reservations — chain ending with .maybeSingle() → Promise

let mockInquiryRows: unknown[]                  = [];
let mockInquiryError: { message: string } | null = null;
let mockReservationRow: unknown                  = null;

// tg_inquiry_flows chain: .select().eq().not()[.eq()] — awaitable
const inquiryChain = {
  select: vi.fn().mockReturnThis(),
  eq:     vi.fn().mockReturnThis(),
  not:    vi.fn().mockReturnThis(),
  then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
    return Promise.resolve({ data: mockInquiryRows, error: mockInquiryError }).then(resolve, reject);
  },
};

// tg_guest_reservations chain: .select().eq().maybeSingle()
const reservationChain = {
  select:      vi.fn().mockReturnThis(),
  eq:          vi.fn().mockReturnThis(),
  maybeSingle: vi.fn().mockImplementation(() =>
    Promise.resolve({ data: mockReservationRow, error: null }),
  ),
};

// tg_inquiry_flows upsert chain (used by other bridge functions — not by recovery)
const fallbackChain = {
  upsert:  vi.fn().mockReturnThis(),
  select:  vi.fn().mockReturnThis(),
  single:  vi.fn().mockResolvedValue({ data: null, error: null }),
  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
};

const mockFrom = vi.fn().mockImplementation((table: string) => {
  if (table === 'tg_inquiry_flows')      return inquiryChain;
  if (table === 'tg_guest_reservations') return reservationChain;
  return fallbackChain;
});

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

// Other bridge deps not exercised by recovery
vi.mock('../timeline', () => ({ appendTimelineEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../inquiry-flow', async (importOriginal) => {
  return await importOriginal<typeof import('../inquiry-flow')>();
});

// Import under test (after mocks)
import { recoverMissingStayFlows } from '../reservation-bridge';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeInquiryRow(overrides: Partial<{
  chat_id: number;
  guest_id: string;
  linked_reservation_id: string;
}> = {}) {
  return {
    chat_id:               1343269271,
    guest_id:              'guest_abc',
    linked_reservation_id: 'res-uuid-live',
    ...overrides,
  };
}

function makeReservationRow(overrides: Partial<{
  id: string;
  property_id: string;
  check_in: string;
  check_out: string;
}> = {}) {
  return {
    id:          'res-uuid-live',
    property_id: 'prop_A',
    check_in:    '2026-04-01',
    check_out:   '2026-04-07',
    ...overrides,
  };
}

function resetMocks() {
  mockInquiryRows  = [];
  mockInquiryError = null;
  mockReservationRow = null;
  mockUpsertStayFlow.mockReset().mockResolvedValue({ id: 'new-stay-uuid', reservationId: 'res-uuid-live' });
  mockGetStayByReservationId.mockReset().mockResolvedValue(null);
  mockFrom.mockClear();
  inquiryChain.select.mockClear();
  inquiryChain.eq.mockClear();
  inquiryChain.not.mockClear();
  reservationChain.select.mockClear();
  reservationChain.eq.mockClear();
  reservationChain.maybeSingle.mockClear();
}

// ─── R1: Missing stay_flow — recovery creates it ──────────────────────────────

describe('R1 — missing stay_flow: created successfully', () => {
  beforeEach(resetMocks);

  it('returns ok:true, recovered:1, skipped:0, errors:0', async () => {
    mockInquiryRows    = [makeInquiryRow()];
    mockReservationRow = makeReservationRow();
    mockGetStayByReservationId.mockResolvedValue(null);

    const result = await recoverMissingStayFlows();

    expect(result.ok).toBe(true);
    expect(result.recovered).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
    expect(result.details[0]).toMatchObject({
      reservationId: 'res-uuid-live',
      chatId:        1343269271,
      status:        'recovered',
    });
  });

  it('calls upsertStayFlow with correct fields from inquiry + reservation', async () => {
    mockInquiryRows    = [makeInquiryRow()];
    mockReservationRow = makeReservationRow();
    mockGetStayByReservationId.mockResolvedValue(null);

    await recoverMissingStayFlows();

    expect(mockUpsertStayFlow).toHaveBeenCalledWith({
      reservationId: 'res-uuid-live',
      chatId:        1343269271,
      guestId:       'guest_abc',
      propertyId:    'prop_A',
      checkinDate:   '2026-04-01',
      checkoutDate:  '2026-04-07',
    });
  });

  it('queries tg_inquiry_flows filtered to converted_to_reservation', async () => {
    mockInquiryRows    = [makeInquiryRow()];
    mockReservationRow = makeReservationRow();

    await recoverMissingStayFlows();

    expect(mockFrom).toHaveBeenCalledWith('tg_inquiry_flows');
    expect(inquiryChain.eq).toHaveBeenCalledWith(
      'inquiry_status',
      'converted_to_reservation',
    );
    expect(inquiryChain.not).toHaveBeenCalledWith('linked_reservation_id', 'is', null);
  });
});

// ─── R2: Stay_flow already exists — skipped ───────────────────────────────────

describe('R2 — stay_flow already exists: skipped', () => {
  beforeEach(resetMocks);

  it('returns ok:true, recovered:0, skipped:1, errors:0', async () => {
    mockInquiryRows = [makeInquiryRow()];
    mockGetStayByReservationId.mockResolvedValue({ id: 'existing-stay', reservationId: 'res-uuid-live' });

    const result = await recoverMissingStayFlows();

    expect(result.ok).toBe(true);
    expect(result.recovered).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors).toBe(0);
    expect(result.details[0]).toMatchObject({ status: 'already_exists' });
  });

  it('does NOT call upsertStayFlow when row already exists', async () => {
    mockInquiryRows = [makeInquiryRow()];
    mockGetStayByReservationId.mockResolvedValue({ id: 'existing-stay', reservationId: 'res-uuid-live' });

    await recoverMissingStayFlows();

    expect(mockUpsertStayFlow).not.toHaveBeenCalled();
  });
});

// ─── R3: Harmless retry — idempotent ──────────────────────────────────────────

describe('R3 — harmless retry: second call produces no duplicate', () => {
  beforeEach(resetMocks);

  it('first call recovers, second call skips — no duplicate upsert', async () => {
    mockInquiryRows    = [makeInquiryRow()];
    mockReservationRow = makeReservationRow();

    // First call: no existing stay_flow → create it
    mockGetStayByReservationId.mockResolvedValueOnce(null);
    const first = await recoverMissingStayFlows();

    expect(first.recovered).toBe(1);
    expect(mockUpsertStayFlow).toHaveBeenCalledTimes(1);

    // Second call: stay_flow now exists → skip
    mockGetStayByReservationId.mockResolvedValueOnce({ id: 'new-stay-uuid', reservationId: 'res-uuid-live' });
    const second = await recoverMissingStayFlows();

    expect(second.recovered).toBe(0);
    expect(second.skipped).toBe(1);
    expect(mockUpsertStayFlow).toHaveBeenCalledTimes(1); // no second call
  });
});

// ─── R4: Reservation row missing — error ──────────────────────────────────────

describe('R4 — reservation_not_found: error recorded', () => {
  beforeEach(resetMocks);

  it('returns ok:true but errors:1 when reservation row is absent', async () => {
    mockInquiryRows    = [makeInquiryRow()];
    mockReservationRow = null; // reservation not found
    mockGetStayByReservationId.mockResolvedValue(null);

    const result = await recoverMissingStayFlows();

    expect(result.ok).toBe(true);
    expect(result.errors).toBe(1);
    expect(result.recovered).toBe(0);
    expect(result.details[0]).toMatchObject({ status: 'error', error: 'reservation_not_found' });
  });

  it('does NOT call upsertStayFlow when reservation is missing', async () => {
    mockInquiryRows    = [makeInquiryRow()];
    mockReservationRow = null;
    mockGetStayByReservationId.mockResolvedValue(null);

    await recoverMissingStayFlows();

    expect(mockUpsertStayFlow).not.toHaveBeenCalled();
  });
});

// ─── R5: Scoped by chatId ─────────────────────────────────────────────────────

describe('R5 — scoped by chatId: only target chat processed', () => {
  beforeEach(resetMocks);

  it('passes chat_id filter to supabase when chatId is supplied', async () => {
    mockInquiryRows    = [makeInquiryRow({ chat_id: 1343269271 })];
    mockReservationRow = makeReservationRow();

    await recoverMissingStayFlows({ chatId: 1343269271 });

    // eq() is called multiple times: inquiry_status filter + chat_id filter
    const eqCalls = inquiryChain.eq.mock.calls;
    expect(eqCalls.some(([col, val]: [string, unknown]) => col === 'chat_id' && val === 1343269271)).toBe(true);
  });

  it('returns recovered:0, skipped:0 when no rows match the scoped chatId', async () => {
    mockInquiryRows = []; // DB returns empty for this chatId

    const result = await recoverMissingStayFlows({ chatId: 9999999 });

    expect(result.ok).toBe(true);
    expect(result.recovered).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
  });
});

// ─── R6: Supabase inquiry query error ─────────────────────────────────────────

describe('R6 — supabase inquiry query error: ok:false', () => {
  beforeEach(resetMocks);

  it('returns ok:false when the tg_inquiry_flows query fails', async () => {
    mockInquiryError = { message: 'connection timeout' };

    const result = await recoverMissingStayFlows();

    expect(result.ok).toBe(false);
    expect(result.error).toContain('connection timeout');
    expect(mockUpsertStayFlow).not.toHaveBeenCalled();
  });
});

// ─── R7: upsertStayFlow returns null ──────────────────────────────────────────

describe('R7 — upsertStayFlow fails: error recorded', () => {
  beforeEach(resetMocks);

  it('records error in details when upsertStayFlow returns null', async () => {
    mockInquiryRows    = [makeInquiryRow()];
    mockReservationRow = makeReservationRow();
    mockGetStayByReservationId.mockResolvedValue(null);
    mockUpsertStayFlow.mockResolvedValue(null); // DB write failure

    const result = await recoverMissingStayFlows();

    expect(result.ok).toBe(true);
    expect(result.recovered).toBe(0);
    expect(result.errors).toBe(1);
    expect(result.details[0]).toMatchObject({ status: 'error', error: 'upsert_failed' });
  });
});
