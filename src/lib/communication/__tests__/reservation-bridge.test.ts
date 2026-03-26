/**
 * Reservation bridge tests.
 *
 * Covers acceptance criteria from feat/inquiry-to-reservation-bridge:
 *   B1 — happy path via chat_id: creates reservation, stay-flow, converts inquiry
 *   B2 — happy path via inquiry_flow_id: same outcome
 *   B3 — inquiry already converted_to_reservation: idempotent, no duplicate writes
 *   B4 — missing inquiry by chat_id: returns ok:false, error:'inquiry_not_found'
 *   B5 — missing inquiry by inquiry_flow_id: returns ok:false, error:'inquiry_not_found'
 *   B6 — conversion_source is 'operator_confirmed'
 *   B7 — stay-flow upserted with correct reservation_id + chat_id
 *   B8 — reservation row upserted with correct fields
 *   B9 — timeline events appended (reservation_linked, stay_flow_initialized, inquiry_converted)
 *   B10 — supabase reservation upsert failure → ok:false with error
 *   B11 — harmless retry on already-converted inquiry returns stayFlowId if available
 *   B12 — both inquiry_flow_id and chat_id missing → caught by route validation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InquiryFlowStatus } from '../inquiry-flow';

// ─── Shared mock state ─────────────────────────────────────────────────────────

const mockGetByChatId      = vi.fn();
const mockGetById          = vi.fn();
const mockUpsertInquiry    = vi.fn().mockResolvedValue(null);
const mockUpsertStayFlow   = vi.fn().mockResolvedValue({ id: 'stay-uuid-1', reservationId: 'res-uuid-1' });
const mockGetStayByResId   = vi.fn().mockResolvedValue(null);
const mockAppendTimeline   = vi.fn().mockResolvedValue(undefined);

// Supabase mock: tg_guest_reservations upsert chain
const mockSupabaseSingle = vi.fn().mockResolvedValue({ data: { id: 'res-uuid-1' }, error: null });
const mockSupabaseSelect  = vi.fn().mockReturnValue({ single: mockSupabaseSingle });
const mockSupabaseUpsert  = vi.fn().mockReturnValue({ select: mockSupabaseSelect });
const mockSupabaseFrom    = vi.fn().mockReturnValue({ upsert: mockSupabaseUpsert });

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => mockSupabaseFrom(...args) },
}));

vi.mock('../timeline', () => ({
  appendTimelineEvent: (...args: unknown[]) => mockAppendTimeline(...args),
}));

vi.mock('../inquiry-flow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../inquiry-flow')>();
  return {
    ...actual,
    getInquiryFlowByChatId: (...args: unknown[]) => mockGetByChatId(...args),
    getInquiryFlowById:     (...args: unknown[]) => mockGetById(...args),
    upsertInquiryFlow:      (...args: unknown[]) => mockUpsertInquiry(...args),
  };
});

vi.mock('../stay-flow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../stay-flow')>();
  return {
    ...actual,
    upsertStayFlow:             (...args: unknown[]) => mockUpsertStayFlow(...args),
    getStayFlowByReservationId: (...args: unknown[]) => mockGetStayByResId(...args),
  };
});

// Import under test (after mocks)
import { operatorLinkReservation } from '../reservation-bridge';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeHandedOffFlow(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date().toISOString();
  return {
    id:             'inquiry-uuid-1',
    chatId:         12345,
    guestId:        'guest_12345',
    inquiryStatus:  InquiryFlowStatus.HandedOff,
    bookingDetails: { desired_dates: 'July 5-10', guest_count: 2, property_ref: 'Moscow' },
    intakeTurnCount: 2,
    handoffType:    'booking_inquiry',
    handoffAt:      new Date(now),
    handoffSummary: 'Booking Inquiry — Human Follow-up Required',
    lastInboundAt:  new Date(now),
    createdAt:      new Date(now),
    updatedAt:      new Date(now),
    ...overrides,
  };
}

function resetMocks() {
  mockGetByChatId.mockReset();
  mockGetById.mockReset();
  mockUpsertInquiry.mockReset().mockResolvedValue(null);
  mockUpsertStayFlow.mockReset().mockResolvedValue({ id: 'stay-uuid-1', reservationId: 'res-uuid-1' });
  mockGetStayByResId.mockReset().mockResolvedValue(null);
  mockAppendTimeline.mockReset().mockResolvedValue(undefined);
  mockSupabaseSingle.mockReset().mockResolvedValue({ data: { id: 'res-uuid-1' }, error: null });
  mockSupabaseSelect.mockReset().mockReturnValue({ single: mockSupabaseSingle });
  mockSupabaseUpsert.mockReset().mockReturnValue({ select: mockSupabaseSelect });
  mockSupabaseFrom.mockReset().mockReturnValue({ upsert: mockSupabaseUpsert });
}

// ─── B1: Happy path via chat_id ──────────────────────────────────────────────

describe('B1 — happy path via chat_id', () => {
  beforeEach(resetMocks);

  it('returns ok:true with reservationId, stayFlowId, inquiryFlowId', async () => {
    mockGetByChatId.mockResolvedValue(makeHandedOffFlow());

    const result = await operatorLinkReservation({
      chatId:         12345,
      reservationRef: 'BOOK-001',
      propertyId:     'prop_A',
      checkIn:        '2026-07-05',
      checkOut:       '2026-07-10',
    });

    expect(result.ok).toBe(true);
    expect(result.reservationId).toBe('res-uuid-1');
    expect(result.stayFlowId).toBe('stay-uuid-1');
    expect(result.inquiryFlowId).toBe('inquiry-uuid-1');
    expect(result.alreadyConverted).toBeUndefined();
  });

  it('calls getInquiryFlowByChatId with the supplied chatId', async () => {
    mockGetByChatId.mockResolvedValue(makeHandedOffFlow());
    await operatorLinkReservation({ chatId: 12345, reservationRef: 'BOOK-001' });
    expect(mockGetByChatId).toHaveBeenCalledWith(12345);
    expect(mockGetById).not.toHaveBeenCalled();
  });
});

// ─── B2: Happy path via inquiry_flow_id ──────────────────────────────────────

describe('B2 — happy path via inquiry_flow_id', () => {
  beforeEach(resetMocks);

  it('returns ok:true and uses getInquiryFlowById', async () => {
    mockGetById.mockResolvedValue(makeHandedOffFlow({ id: 'inquiry-uuid-by-id' }));

    const result = await operatorLinkReservation({
      inquiryFlowId:  'inquiry-uuid-by-id',
      reservationRef: 'BOOK-002',
    });

    expect(result.ok).toBe(true);
    expect(result.inquiryFlowId).toBe('inquiry-uuid-by-id');
    expect(mockGetById).toHaveBeenCalledWith('inquiry-uuid-by-id');
    expect(mockGetByChatId).not.toHaveBeenCalled();
  });
});

// ─── B3: Already converted — idempotent ──────────────────────────────────────

describe('B3 — already converted_to_reservation: idempotent retry', () => {
  beforeEach(resetMocks);

  it('returns ok:true, alreadyConverted:true without touching DB again', async () => {
    mockGetByChatId.mockResolvedValue(
      makeHandedOffFlow({
        inquiryStatus:        InquiryFlowStatus.ConvertedToReservation,
        linkedReservationId:  'existing-res-uuid',
      }),
    );

    const result = await operatorLinkReservation({ chatId: 12345, reservationRef: 'BOOK-001' });

    expect(result.ok).toBe(true);
    expect(result.alreadyConverted).toBe(true);
    expect(result.reservationId).toBe('existing-res-uuid');

    // Must NOT write anything new
    expect(mockSupabaseUpsert).not.toHaveBeenCalled();
    expect(mockUpsertStayFlow).not.toHaveBeenCalled();
    expect(mockUpsertInquiry).not.toHaveBeenCalled();
  });

  it('returns existing stayFlowId when stay-flow is already present', async () => {
    mockGetByChatId.mockResolvedValue(
      makeHandedOffFlow({
        inquiryStatus:       InquiryFlowStatus.ConvertedToReservation,
        linkedReservationId: 'existing-res-uuid',
      }),
    );
    mockGetStayByResId.mockResolvedValue({ id: 'existing-stay-uuid', reservationId: 'existing-res-uuid' });

    const result = await operatorLinkReservation({ chatId: 12345, reservationRef: 'BOOK-001' });

    expect(result.stayFlowId).toBe('existing-stay-uuid');
  });
});

// ─── B4: Missing inquiry by chat_id ──────────────────────────────────────────

describe('B4 — missing inquiry by chat_id', () => {
  beforeEach(resetMocks);

  it('returns ok:false, error:inquiry_not_found', async () => {
    mockGetByChatId.mockResolvedValue(null);

    const result = await operatorLinkReservation({ chatId: 99999, reservationRef: 'BOOK-X' });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('inquiry_not_found');
  });
});

// ─── B5: Missing inquiry by inquiry_flow_id ───────────────────────────────────

describe('B5 — missing inquiry by inquiry_flow_id', () => {
  beforeEach(resetMocks);

  it('returns ok:false, error:inquiry_not_found', async () => {
    mockGetById.mockResolvedValue(null);

    const result = await operatorLinkReservation({
      inquiryFlowId:  'non-existent-uuid',
      reservationRef: 'BOOK-X',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('inquiry_not_found');
  });
});

// ─── B6: conversion_source is 'operator_confirmed' ───────────────────────────

describe('B6 — conversion_source persisted as operator_confirmed', () => {
  beforeEach(resetMocks);

  it('upsertInquiryFlow is called with conversionSource=operator_confirmed', async () => {
    mockGetByChatId.mockResolvedValue(makeHandedOffFlow());

    await operatorLinkReservation({ chatId: 12345, reservationRef: 'BOOK-001' });

    expect(mockUpsertInquiry).toHaveBeenCalledWith(
      expect.objectContaining({ conversionSource: 'operator_confirmed' }),
    );
  });
});

// ─── B7: Stay-flow upserted with correct fields ───────────────────────────────

describe('B7 — stay-flow upserted correctly', () => {
  beforeEach(resetMocks);

  it('upsertStayFlow called with reservationId, chatId, guestId, dates', async () => {
    mockGetByChatId.mockResolvedValue(makeHandedOffFlow());

    await operatorLinkReservation({
      chatId:         12345,
      reservationRef: 'BOOK-001',
      propertyId:     'prop_A',
      checkIn:        '2026-07-05',
      checkOut:       '2026-07-10',
    });

    expect(mockUpsertStayFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: 'res-uuid-1',
        chatId:        12345,
        guestId:       'guest_12345',
        propertyId:    'prop_A',
        checkinDate:   '2026-07-05',
        checkoutDate:  '2026-07-10',
      }),
    );
  });

  it('upsertStayFlow called even when no dates are provided', async () => {
    mockGetByChatId.mockResolvedValue(makeHandedOffFlow());

    await operatorLinkReservation({ chatId: 12345, reservationRef: 'BOOK-001' });

    expect(mockUpsertStayFlow).toHaveBeenCalledOnce();
    expect(mockUpsertStayFlow).toHaveBeenCalledWith(
      expect.objectContaining({ reservationId: 'res-uuid-1' }),
    );
  });
});

// ─── B8: Reservation row upserted with correct fields ────────────────────────

describe('B8 — reservation row upserted correctly', () => {
  beforeEach(resetMocks);

  it('tg_guest_reservations upsert receives all operator-supplied fields', async () => {
    mockGetByChatId.mockResolvedValue(makeHandedOffFlow());

    await operatorLinkReservation({
      chatId:         12345,
      reservationRef: 'AIRBNB-999',
      propertyId:     'prop_B',
      guestName:      'Ivan Petrov',
      checkIn:        '2026-08-01',
      checkOut:       '2026-08-07',
    });

    expect(mockSupabaseFrom).toHaveBeenCalledWith('tg_guest_reservations');
    expect(mockSupabaseUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        reservation_ref: 'AIRBNB-999',
        chat_id:         12345,
        guest_id:        'guest_12345',
        property_id:     'prop_B',
        guest_name:      'Ivan Petrov',
        check_in:        '2026-08-01',
        check_out:       '2026-08-07',
        status:          'confirmed',
      }),
      expect.objectContaining({ onConflict: 'reservation_ref' }),
    );
  });
});

// ─── B9: Timeline events appended ────────────────────────────────────────────

describe('B9 — timeline events appended for audit continuity', () => {
  beforeEach(resetMocks);

  it('appends reservation_linked, stay_flow_initialized, inquiry_converted events', async () => {
    mockGetByChatId.mockResolvedValue(makeHandedOffFlow());

    await operatorLinkReservation({ chatId: 12345, reservationRef: 'BOOK-001' });

    const types = mockAppendTimeline.mock.calls.map(
      (call) => (call[1] as { type: string }).type,
    );

    expect(types).toContain('reservation_linked');
    expect(types).toContain('stay_flow_initialized');
    expect(types).toContain('inquiry_converted');
  });

  it('inquiry_converted event includes conversion_source=operator_confirmed', async () => {
    mockGetByChatId.mockResolvedValue(makeHandedOffFlow());

    await operatorLinkReservation({ chatId: 12345, reservationRef: 'BOOK-001' });

    const convertedCall = mockAppendTimeline.mock.calls.find(
      (call) => (call[1] as { type: string }).type === 'inquiry_converted',
    );

    expect(convertedCall).toBeDefined();
    expect(convertedCall![1]).toMatchObject({ conversion_source: 'operator_confirmed' });
  });

  it('operator_note is included in reservation_linked event when provided', async () => {
    mockGetByChatId.mockResolvedValue(makeHandedOffFlow());

    await operatorLinkReservation({
      chatId:         12345,
      reservationRef: 'BOOK-001',
      operatorNote:   'Confirmed via phone call',
    });

    const linkedCall = mockAppendTimeline.mock.calls.find(
      (call) => (call[1] as { type: string }).type === 'reservation_linked',
    );
    expect(linkedCall![1]).toMatchObject({ operator_note: 'Confirmed via phone call' });
  });

  it('no timeline events if guestId is unknown (null-safe)', async () => {
    mockGetByChatId.mockResolvedValue(makeHandedOffFlow({ guestId: undefined }));

    await operatorLinkReservation({ chatId: 12345, reservationRef: 'BOOK-001' });

    expect(mockAppendTimeline).not.toHaveBeenCalled();
  });
});

// ─── B10: Supabase reservation upsert failure ─────────────────────────────────

describe('B10 — supabase failure returns ok:false', () => {
  beforeEach(resetMocks);

  it('returns ok:false when reservation upsert errors', async () => {
    mockGetByChatId.mockResolvedValue(makeHandedOffFlow());
    mockSupabaseSingle.mockResolvedValue({
      data:  null,
      error: { message: 'DB connection error' },
    });

    const result = await operatorLinkReservation({ chatId: 12345, reservationRef: 'BOOK-001' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('reservation_upsert_failed');
    // Stay-flow and inquiry conversion must NOT have been called
    expect(mockUpsertStayFlow).not.toHaveBeenCalled();
    expect(mockUpsertInquiry).not.toHaveBeenCalled();
  });
});

// ─── B11: Harmless retry returns existing stay-flow ───────────────────────────

describe('B11 — harmless retry on already-converted inquiry', () => {
  beforeEach(resetMocks);

  it('second call is a no-op and returns existing IDs', async () => {
    const convertedFlow = makeHandedOffFlow({
      inquiryStatus:       InquiryFlowStatus.ConvertedToReservation,
      linkedReservationId: 'res-uuid-existing',
    });
    mockGetByChatId.mockResolvedValue(convertedFlow);
    mockGetStayByResId.mockResolvedValue({ id: 'stay-uuid-existing', reservationId: 'res-uuid-existing' });

    const result = await operatorLinkReservation({ chatId: 12345, reservationRef: 'BOOK-001' });

    expect(result.ok).toBe(true);
    expect(result.alreadyConverted).toBe(true);
    expect(result.reservationId).toBe('res-uuid-existing');
    expect(result.stayFlowId).toBe('stay-uuid-existing');
    expect(mockSupabaseUpsert).not.toHaveBeenCalled();
    expect(mockUpsertInquiry).not.toHaveBeenCalled();
    expect(mockUpsertStayFlow).not.toHaveBeenCalled();
  });
});

// ─── B12: Inquiry status transition ───────────────────────────────────────────

describe('B12 — inquiry converted_to_reservation with correct fields', () => {
  beforeEach(resetMocks);

  it('upsertInquiryFlow called with converted status, linkedReservationId, convertedAt', async () => {
    mockGetByChatId.mockResolvedValue(makeHandedOffFlow());

    await operatorLinkReservation({ chatId: 12345, reservationRef: 'BOOK-001' });

    expect(mockUpsertInquiry).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId:              12345,
        status:              InquiryFlowStatus.ConvertedToReservation,
        linkedReservationId: 'res-uuid-1',
        conversionSource:    'operator_confirmed',
      }),
    );
    const call = mockUpsertInquiry.mock.calls[0][0] as Record<string, unknown>;
    expect(call.convertedAt).toBeInstanceOf(Date);
  });
});
