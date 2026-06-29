import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingOpsRecord } from '../types';

const mockReservationRows: Record<string, Record<string, unknown>> = {};
const mockOpsRows: Record<string, Record<string, unknown>> = {};
let mockOpsByBookingId: Record<string, unknown> | null = null;

function makeOpsRow(overrides: Partial<BookingOpsRecord> & { id: string }): Record<string, unknown> {
  return {
    booking_id: overrides.bookingId ?? null,
    guest_name: overrides.guestName ?? null,
    guest_phone: overrides.guestPhone ?? null,
    guest_email: overrides.guestEmail ?? null,
    guest_telegram: overrides.guestTelegram ?? null,
    property_id: overrides.propertyId ?? null,
    property_label: overrides.propertyLabel ?? null,
    ota_source: overrides.otaSource ?? null,
    check_in_at: overrides.checkInAt ?? null,
    check_out_at: overrides.checkOutAt ?? null,
    ops_status: overrides.opsStatus ?? 'created',
    manual_next_action: overrides.manualNextAction ?? null,
    is_blocked: overrides.isBlocked ?? false,
    blocker_reason: overrides.blockerReason ?? null,
    documents_status: overrides.documentsStatus ?? 'not_started',
    contract_status: overrides.contractStatus ?? 'not_started',
    deposit_status: overrides.depositStatus ?? 'not_started',
    mvd_status: overrides.mvdStatus ?? 'not_required',
    checkin_readiness_status: overrides.checkinReadinessStatus ?? 'not_started',
    unit_readiness_status: overrides.unitReadinessStatus ?? 'not_ready',
    notes: overrides.notes ?? null,
    created_at: overrides.createdAt ?? '2026-06-27T08:00:00.000Z',
    updated_at: overrides.updatedAt ?? '2026-06-27T08:00:00.000Z',
    id: overrides.id,
  };
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'tg_guest_reservations') {
        return {
          select: () => ({
            eq: (_col: string, id: string) => ({
              maybeSingle: async () => ({
                data: mockReservationRows[id] ?? null,
                error: null,
              }),
            }),
            order: () => ({
              limit: async () => ({
                data: Object.entries(mockReservationRows).map(([id]) => ({ id })),
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === 'booking_ops_records') {
        const chain = {
          _filters: [] as Array<{ col: string; val: string }>,
          select: () => chain,
          eq: (col: string, val: string) => {
            chain._filters.push({ col, val });
            return chain;
          },
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => {
            if (chain._filters.some((f) => f.col === 'booking_id')) {
              return { data: mockOpsByBookingId, error: null };
            }
            const idFilter = chain._filters.find((f) => f.col === 'id');
            return {
              data: idFilter ? mockOpsRows[idFilter.val] ?? null : null,
              error: null,
            };
          },
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                const id = String(row.id);
                mockOpsRows[id] = { ...row };
                if (row.booking_id) mockOpsByBookingId = mockOpsRows[id];
                return { data: mockOpsRows[id], error: null };
              },
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: (_col: string, id: string) => ({
              select: () => ({
                maybeSingle: async () => {
                  if (!mockOpsRows[id]) return { data: null, error: null };
                  mockOpsRows[id] = { ...mockOpsRows[id], ...patch };
                  if (mockOpsRows[id].booking_id) mockOpsByBookingId = mockOpsRows[id];
                  return { data: mockOpsRows[id], error: null };
                },
              }),
            }),
          }),
        };
        return chain;
      }

      return {};
    },
  },
}));

import {
  backfillBookingOpsFromReservations,
  syncBookingOpsFromReservation,
} from '../reservation-sync';
import {
  buildSafeSourceFieldPatch,
  mapReservationToBookingOpsInput,
  wouldDowngradeOpsStatus,
} from '../reservation-mapping';
import { evaluateBookingOpsAutomation } from '../decision-engine';

describe('Booking Ops reservation source link', () => {
  beforeEach(() => {
    Object.keys(mockReservationRows).forEach((key) => delete mockReservationRows[key]);
    Object.keys(mockOpsRows).forEach((key) => delete mockOpsRows[key]);
    mockOpsByBookingId = null;
  });

  it('creates ops record from reservation', async () => {
    mockReservationRows['res-1'] = {
      id: 'res-1',
      reservation_ref: 'BOOK-100',
      property_id: 'lit-12',
      guest_name: 'Анна Иванова',
      guest_contact: '+79991112233',
      check_in: '2026-07-10T14:00:00.000Z',
      check_out: '2026-07-12T11:00:00.000Z',
      booking_channel: 'avito',
      status: 'confirmed',
    };

    const result = await syncBookingOpsFromReservation('res-1');
    expect(result.outcome).toBe('created');
    expect(result.record).toMatchObject({
      bookingId: 'res-1',
      guestName: 'Анна Иванова',
      guestPhone: '+79991112233',
      propertyId: 'lit-12',
      otaSource: 'avito',
      opsStatus: 'guest_contact_known',
    });
    expect(result.record?.automation?.nextAction).toBe('request_guest_documents');
  });

  it('is idempotent and does not duplicate records', async () => {
    mockReservationRows['res-2'] = {
      id: 'res-2',
      property_id: 'obj-2',
      guest_name: 'Пётр',
      phone: '+79990000002',
      status: 'confirmed',
    };

    const first = await syncBookingOpsFromReservation('res-2');
    const second = await syncBookingOpsFromReservation('res-2');

    expect(first.outcome).toBe('created');
    expect(second.outcome).toBe('already_exists');
    expect(Object.keys(mockOpsRows)).toHaveLength(1);
  });

  it('updates safe source fields without overwriting human notes', async () => {
    mockReservationRows['res-3'] = {
      id: 'res-3',
      property_id: 'obj-3',
      guest_name: 'Мария Новая',
      phone: '+79990000003',
      check_in: '2026-08-01T14:00:00.000Z',
      status: 'confirmed',
    };
    mockOpsByBookingId = makeOpsRow({
      id: 'ops-3',
      bookingId: 'res-3',
      guestName: 'Мария',
      guestPhone: '+79990000003',
      propertyId: 'obj-3',
      opsStatus: 'documents_requested',
      notes: 'Заметка оператора',
    });
    mockOpsRows['ops-3'] = mockOpsByBookingId;

    const result = await syncBookingOpsFromReservation('res-3');
    expect(result.outcome).toBe('updated');
    expect(result.record?.guestName).toBe('Мария Новая');
    expect(result.record?.notes).toBe('Заметка оператора');
    expect(result.record?.opsStatus).toBe('documents_requested');
  });

  it('does not downgrade manually advanced statuses', () => {
    expect(wouldDowngradeOpsStatus('contract_signed', 'guest_contact_known')).toBe(true);
    expect(wouldDowngradeOpsStatus('guest_contact_known', 'documents_requested')).toBe(false);

    const existing: BookingOpsRecord = {
      id: 'ops-4',
      bookingId: 'res-4',
      guestName: 'Олег',
      guestPhone: '+79990000004',
      guestEmail: null,
      guestTelegram: null,
      propertyId: 'obj-4',
      propertyLabel: null,
      otaSource: 'manual',
      checkInAt: null,
      checkOutAt: null,
      opsStatus: 'contract_signed',
      manualNextAction: null,
      isBlocked: false,
      blockerReason: null,
      documentsStatus: 'verified',
      contractStatus: 'signed',
      depositStatus: 'not_started',
      mvdStatus: 'not_required',
      checkinReadinessStatus: 'not_started',
      unitReadinessStatus: 'not_ready',
      notes: null,
      createdAt: '2026-06-27T08:00:00.000Z',
      updatedAt: '2026-06-27T08:00:00.000Z',
    };

    const derived = mapReservationToBookingOpsInput({
      id: 'res-4',
      reservationRef: null,
      propertyId: 'obj-4',
      guestName: 'Олег',
      guestContact: '+79990000004',
      guestPhone: null,
      phone: null,
      email: null,
      chatId: null,
      guestId: null,
      checkIn: null,
      checkOut: null,
      bookingChannel: 'manual',
      status: 'confirmed',
      note: null,
      pilotAcceptanceMarker: null,
    });

    const patch = buildSafeSourceFieldPatch(existing, derived);
    expect(patch.opsStatus).toBeUndefined();
  });

  it('routes missing contact data to needs_operator_attention', () => {
    const derived = mapReservationToBookingOpsInput({
      id: 'res-5',
      reservationRef: null,
      propertyId: 'obj-5',
      guestName: 'Без контакта',
      guestContact: null,
      guestPhone: null,
      phone: null,
      email: null,
      chatId: null,
      guestId: null,
      checkIn: '2026-07-01T14:00:00.000Z',
      checkOut: '2026-07-03T11:00:00.000Z',
      bookingChannel: 'manual',
      status: 'confirmed',
      note: null,
      pilotAcceptanceMarker: null,
    });

    const decision = evaluateBookingOpsAutomation({
      id: 'ops-5',
      bookingId: 'res-5',
      guestName: derived.guestName ?? null,
      guestPhone: null,
      guestEmail: null,
      guestTelegram: null,
      propertyId: derived.propertyId ?? null,
      propertyLabel: null,
      otaSource: derived.otaSource ?? null,
      checkInAt: derived.checkInAt ?? null,
      checkOutAt: derived.checkOutAt ?? null,
      opsStatus: 'created',
      manualNextAction: null,
      isBlocked: false,
      blockerReason: null,
      documentsStatus: 'not_started',
      contractStatus: 'not_started',
      depositStatus: 'not_started',
      mvdStatus: 'not_required',
      checkinReadinessStatus: 'not_started',
      unitReadinessStatus: 'not_ready',
      notes: null,
      createdAt: '2026-06-27T08:00:00.000Z',
      updatedAt: '2026-06-27T08:00:00.000Z',
    });

    expect(decision.nextAction).toBe('needs_operator_attention');
  });

  it('supports backfill dry-run and create modes', async () => {
    mockReservationRows['res-6'] = {
      id: 'res-6',
      property_id: 'obj-6',
      guest_name: 'Backfill',
      phone: '+79990000006',
      status: 'confirmed',
    };

    const dryRun = await backfillBookingOpsFromReservations({ dryRun: true, limit: 10 });
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.created).toBe(1);
    expect(Object.keys(mockOpsRows)).toHaveLength(0);

    const createRun = await backfillBookingOpsFromReservations({ dryRun: false, limit: 10 });
    expect(createRun.created).toBe(1);
    expect(Object.keys(mockOpsRows)).toHaveLength(1);
  });
});
