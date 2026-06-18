import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSupabaseFrom = vi.fn();
const mockReplyToTelegram = vi.fn();
const mockRecordCrmCommunicationEvent = vi.fn();
const mockUpdateCrmContact = vi.fn();
const mockPatchTelegramRoutingSession = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
  },
}));

vi.mock('@/lib/telegram', () => ({
  replyToTelegram: (...args: unknown[]) => mockReplyToTelegram(...args),
}));

vi.mock('@/lib/crm/repository', () => ({
  recordCrmCommunicationEvent: (...args: unknown[]) => mockRecordCrmCommunicationEvent(...args),
  updateCrmContact: (...args: unknown[]) => mockUpdateCrmContact(...args),
}));

vi.mock('@/lib/communication/telegram-routing-session', () => ({
  patchTelegramRoutingSession: (...args: unknown[]) => mockPatchTelegramRoutingSession(...args),
}));

vi.mock('@/lib/communication/telegram-identity-memory', () => ({
  patchTelegramIdentityMemory: vi.fn().mockResolvedValue(undefined),
}));

import { launchGuestTestForProperty } from '@/lib/crm/guest-test-flow';
import { resolveSetupNextStep } from '@/lib/property-setup/setup-next-step';
import { computeObjectGuestReadiness } from '@/lib/property-setup/object-guest-readiness';
import { createEmptySetupData } from '@/lib/property-setup/setup-data';
import type { OpsProperty, PropertyMasterCard } from '@/lib/ops-foundation/types';

function chain(result: unknown) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => result),
    single: vi.fn(async () => result),
    update: vi.fn(() => builder),
    then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

const property: OpsProperty = {
  id: 'prop-1',
  accountId: 'acct-1',
  title: 'Тест',
  address: 'ул. Баумана, 1',
  city: 'Казань',
  timezone: 'Europe/Moscow',
  status: 'draft',
  createdAt: '2026-06-16T00:00:00.000Z',
  updatedAt: '2026-06-16T00:00:00.000Z',
};

const masterCard: PropertyMasterCard = {
  id: 'card-1',
  propertyId: 'prop-1',
  publicTitle: null,
  shortDescription: null,
  fullDescription: null,
  amenities: [],
  houseRules: null,
  checkInInstructions: null,
  checkOutInstructions: null,
  wifiName: null,
  wifiPassword: null,
  parkingInfo: null,
  depositInfo: null,
  extraFeesInfo: null,
  cancellationInfo: null,
  guestContactsInfo: null,
  internalNotes: null,
  contentVersion: 1,
  publicationStatus: 'draft',
  createdAt: '2026-06-16T00:00:00.000Z',
  updatedAt: '2026-06-16T00:00:00.000Z',
};

function readyReadiness() {
  const setup = createEmptySetupData();
  setup.basic.city = 'Казань';
  setup.address.line = 'ул. Баумана, 1';
  setup.checkInOut.checkInInstructions = 'Код 1234';
  setup.wifi.wifiName = 'ASI';
  setup.rules.smoking = 'Запрещено';
  setup.description.full = 'Уютная квартира.';

  return computeObjectGuestReadiness({
    propertyId: 'prop-1',
    property,
    masterCard,
    setup,
    media: [
      {
        id: 'photo-1',
        propertyId: 'prop-1',
        url: 'https://example.com/photo.jpg',
        storagePath: null,
        title: null,
        description: null,
        sortOrder: 0,
        isCover: true,
        status: 'active',
        createdAt: '2026-06-16T00:00:00.000Z',
        updatedAt: '2026-06-16T00:00:00.000Z',
      },
    ],
  });
}

describe('readiness guest test launch CTA', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReplyToTelegram.mockResolvedValue(undefined);
    mockRecordCrmCommunicationEvent.mockResolvedValue(undefined);
    mockUpdateCrmContact.mockResolvedValue(undefined);
    mockPatchTelegramRoutingSession.mockReturnValue({});
  });

  it('does not show passive Open Telegram CTA before guest_test is started', () => {
    const step = resolveSetupNextStep({
      readiness: readyReadiness(),
      telegramLinked: true,
      guestTestDispatched: false,
      onSetupPage: true,
    });

    expect(step.phase).toBe('launch_guest_test');
    expect(step.primaryCta.kind).toBe('launch_guest_test');
    expect(step.primaryCta.label).toBe('Запустить тест гостя в Telegram');
    expect(step.primaryCta.label).not.toBe('Открыть Telegram');
    expect(step.showTelegramFallback).toBe(true);
    expect(step.guestTestCommand).toBe('/guest_test prop-1');
  });

  it('shows restart label after guest_test_started is recorded', () => {
    const step = resolveSetupNextStep({
      readiness: readyReadiness(),
      telegramLinked: true,
      guestTestDispatched: true,
      onSetupPage: true,
    });

    expect(step.phase).toBe('guest_test_started');
    expect(step.statusMessage).toContain('Тест гостя запущен');
    expect(step.primaryCta.label).toBe('Открыть Telegram');
    expect(step.secondaryCta?.kind).toBe('launch_guest_test');
    expect(step.secondaryCta?.label).toBe('Перезапустить тест гостя в Telegram');
  });

  it('dispatches guest test when CRM contact has telegram chat_id', async () => {
    const ownerContact = {
      id: 'contact-1',
      name: 'Owner',
      role: 'owner',
      source: 'pilot_form',
      contact: '@owner',
      telegram_user_id: '1001',
      telegram_username: 'owner',
      telegram_chat_id: '8101',
      status: 'object_filled',
      property_id: 'prop-1',
      property_count: 1,
      notes: null,
      next_action: 'Запустить тест гостя',
      next_action_due_at: null,
      last_message: null,
      last_activity_at: null,
      lead_id: null,
      awaiting_reply: false,
      created_at: '2026-06-16T00:00:00.000Z',
      updated_at: '2026-06-16T00:00:00.000Z',
    };

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'crm_contacts') {
        return chain({ data: [ownerContact], error: null });
      }
      if (table === 'crm_events') {
        return chain({ data: null, error: null });
      }
      return chain({ data: null, error: null });
    });

    const result = await launchGuestTestForProperty('prop-1');

    expect(result.mode).toBe('dispatched');
    expect(mockReplyToTelegram).toHaveBeenCalledWith(
      8101,
      expect.stringContaining('Тестовый режим гостя'),
      expect.any(Object),
      expect.any(Object),
    );
    expect(mockRecordCrmCommunicationEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'guest_test_started', propertyId: 'prop-1' }),
    );
  });

  it('returns deep link when telegram chat_id is unknown', async () => {
    const ownerContact = {
      id: 'contact-1',
      name: 'Owner',
      role: 'owner',
      source: 'pilot_form',
      contact: '@owner',
      telegram_user_id: null,
      telegram_username: null,
      telegram_chat_id: null,
      status: 'object_filled',
      property_id: 'prop-1',
      property_count: 1,
      notes: null,
      next_action: 'Запустить тест гостя',
      next_action_due_at: null,
      last_message: null,
      last_activity_at: null,
      lead_id: null,
      awaiting_reply: false,
      created_at: '2026-06-16T00:00:00.000Z',
      updated_at: '2026-06-16T00:00:00.000Z',
    };

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'crm_contacts') {
        return chain({ data: [ownerContact], error: null });
      }
      if (table === 'crm_events') {
        return chain({ data: null, error: null });
      }
      return chain({ data: null, error: null });
    });

    const result = await launchGuestTestForProperty('prop-1');

    expect(result.mode).toBe('deep_link');
    expect(result.deepLink).toContain('guest_test_prop-1');
    expect(result.guestTestCommand).toBe('/guest_test prop-1');
    expect(mockReplyToTelegram).not.toHaveBeenCalled();
  });
});
