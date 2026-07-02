import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHANNEL_MANAGER_CONNECTION_STATUS_LABELS } from '@/lib/channel-manager-connection/labels';
import { computePilotReadiness } from '@/lib/pilot-readiness/engine';
import { PILOT_SETUP_STATUS_VALUES } from '@/lib/crm/types';
import {
  BOOKING_LIFECYCLE_GATE_KEYS,
  type BookingLifecycleGateKey,
  type BookingLifecycleStatus,
} from '../lifecycle-types';

const initializeLifecycleForBooking = vi.fn(async () => ({ ok: true, gates: [] }));
const initializeGuestLegalExecution = vi.fn(async () => ({ bookingId: 'ASI_PILOT_CORE_LOOP_DEMO' }));
const ensurePhysicalTasks = vi.fn(async () => ({ bookingId: 'ASI_PILOT_CORE_LOOP_DEMO' }));

vi.mock('../lifecycle', () => ({ initializeLifecycleForBooking }));
vi.mock('../guest-legal-deposit-mvd-execution', () => ({ initializeGuestLegalExecution }));
vi.mock('../physical-readiness-execution', () => ({ ensurePhysicalTasks }));

describe('Pilot Core Loop Readiness v1', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes lifecycle and manual legal/payment placeholders for every new booking', async () => {
    const { initializeBookingOpsCoreLoop } = await import('../core-loop-initialization');

    await expect(initializeBookingOpsCoreLoop('ASI_PILOT_CORE_LOOP_DEMO')).resolves.toEqual({
      lifecycleInitialized: true,
      legalPaymentInitialized: true,
      physicalReadinessInitialized: true,
    });
    expect(initializeLifecycleForBooking).toHaveBeenCalledWith('ASI_PILOT_CORE_LOOP_DEMO');
    expect(initializeGuestLegalExecution).toHaveBeenCalledWith('ASI_PILOT_CORE_LOOP_DEMO');
    expect(ensurePhysicalTasks).toHaveBeenCalledWith('ASI_PILOT_CORE_LOOP_DEMO');
  });

  it('represents owner setup and manual OTA publication without a live OTA API', () => {
    expect(PILOT_SETUP_STATUS_VALUES).toEqual([
      'instruction_sent',
      'access_received',
      'test_object_selected',
      'object_setup',
      'ready_for_test',
    ]);
    expect(CHANNEL_MANAGER_CONNECTION_STATUS_LABELS.prepared).toContain('публикация вручную');
    expect(CHANNEL_MANAGER_CONNECTION_STATUS_LABELS.connected).toContain('вручную');

    const readiness = computePilotReadiness({
      propertyId: 'ASI_PILOT_OBJECT_DEMO',
      objectLabel: 'Демо-объект пилота',
      name: 'Демо-объект пилота',
      address: 'Тестовый адрес без персональных данных',
      description: 'Тестовое описание',
      rules: 'Тестовые правила',
      checkInTime: '15:00',
      checkOutTime: '12:00',
      wifiName: 'ASI-DEMO',
      wifiPassword: null,
      wifiSkipped: false,
      accessNotes: 'Тестовый ручной доступ',
      checkinInstructions: 'Инструкция готовится оператором',
      photosDeferred: true,
      photosCount: 0,
      bookingChannels: 'Ручная публикация',
      communicationMode: 'manual',
      contactId: 'ASI_PILOT_OWNER_DEMO',
      ownerName: 'Тестовый владелец',
    });

    expect(readiness.ready).toBe(true);
  });

  it('simulates one full pilot booking through booking_closed without normal-state fallback', () => {
    const state = new Map<BookingLifecycleGateKey, BookingLifecycleStatus>(
      BOOKING_LIFECYCLE_GATE_KEYS.map((gateKey) => [
        gateKey,
        gateKey === 'booking_received' ? 'completed' : 'pending',
      ]),
    );
    const fallbackGates = () => [...state.entries()]
      .filter(([, status]) => status === 'blocked' || status === 'failed')
      .map(([gateKey]) => gateKey);
    const complete = (...gateKeys: BookingLifecycleGateKey[]) => {
      gateKeys.forEach((gateKey) => state.set(gateKey, 'completed'));
    };

    expect(fallbackGates()).toEqual([]);

    complete('guest_data_requested', 'guest_data_completed', 'documents_requested', 'documents_received');
    state.set('documents_verified', 'blocked');
    expect(fallbackGates()).toEqual(['documents_verified']);

    complete(
      'documents_verified',
      'contract_prepared',
      'contract_sent',
      'contract_signed',
      'deposit_requested',
      'deposit_received',
      'mvd_report_prepared',
      'mvd_report_submitted',
      'cleaning_scheduled',
      'linen_scheduled',
      'inspection_scheduled',
    );
    state.set('maintenance_required', 'skipped');
    state.set('maintenance_resolved', 'skipped');
    complete(
      'property_ready',
      'checkin_instructions_sent',
      'guest_checked_in',
      'guest_checked_out',
      'post_checkout_inspection_done',
      'deposit_return_ready',
      'booking_closed',
    );

    expect(fallbackGates()).toEqual([]);
    expect(state.get('booking_closed')).toBe('completed');
    expect([...state.values()].every((status) => status === 'completed' || status === 'skipped')).toBe(true);
  });
});
