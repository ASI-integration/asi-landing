import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { tgTextUpdate } from '@/lib/communication/dev/telegram-fixtures';
import {
  formatPilotSmokeSummary,
  type PilotSmokeBlockResult,
} from '@/lib/pilot/pilot-acceptance-smoke-report';
import { computeObjectGuestReadiness } from '@/lib/property-setup/object-guest-readiness';
import { createEmptySetupData } from '@/lib/property-setup/setup-data';
import {
  filterSetupStepsForGrid,
  getSetupFillableStepCount,
  resolveSetupProgressCounts,
  resolveSetupReadinessPageUi,
  shouldShowSetupNextButton,
  shouldShowTopReadinessBlock,
} from '@/lib/property-setup/setup-readiness-ui';
import {
  containsBogusDashboardOrigin,
  toAppAbsoluteUrl,
  toAppPath,
} from '@/lib/app-url';
import {
  buildCrmPropertyAutomationSummary,
  deriveCrmAutomationSuggestion,
} from '@/lib/crm/automation-loop';
import type { OpsProperty, PropertyMasterCard, PropertyMedia } from '@/lib/ops-foundation/types';

const mockReplyToTelegram = vi.fn();
const mockAnswerTelegramCallbackQuery = vi.fn();
const mockSendTelegramMessageToChat = vi.fn();
const mockBeginLead = vi.fn();
const mockBeginSupport = vi.fn();
const mockDecideAutopilot = vi.fn();
const mockLookupBooking = vi.fn();
const mockResolveGuestContext = vi.fn();
const mockLookupProperty = vi.fn();
const mockLookupGuestTestProperty = vi.fn();
const mockUpsertCrmContactFromTelegram = vi.fn();
const mockRecordCrmCommunicationEvent = vi.fn();
const mockRecordCrmEventFromOwnerNotification = vi.fn();
const mockAttachTelegramToPilotContact = vi.fn();
const mockLoadObjectGuestReadiness = vi.fn();

vi.mock('@/lib/crm/property-readiness-sync', () => ({
  loadObjectGuestReadiness: (...args: unknown[]) => mockLoadObjectGuestReadiness(...args),
}));

vi.mock('@/lib/communication/guest-test-property', () => ({
  lookup_property_for_guest_test: (...args: unknown[]) => mockLookupGuestTestProperty(...args),
}));

vi.mock('@/lib/telegram', () => ({
  replyToTelegram: (...args: unknown[]) => mockReplyToTelegram(...args),
  answerTelegramCallbackQuery: (...args: unknown[]) => mockAnswerTelegramCallbackQuery(...args),
  sendTelegramMessageToChat: (...args: unknown[]) => mockSendTelegramMessageToChat(...args),
}));

vi.mock('@/lib/communication/telegram-lead-intake', async () => {
  const actual = await vi.importActual<typeof import('@/lib/communication/telegram-lead-intake')>(
    '@/lib/communication/telegram-lead-intake',
  );
  return {
    ...actual,
    beginTelegramLeadIntakeFromRouting: (...args: unknown[]) => mockBeginLead(...args),
    beginTelegramSupportFromRouting: (...args: unknown[]) => mockBeginSupport(...args),
  };
});

vi.mock('@/lib/communication/autopilot', () => ({
  decideCommunicationAutopilotResponseWithLlmRouter: (...args: unknown[]) => mockDecideAutopilot(...args),
}));

vi.mock('@/lib/communication/persistence', () => ({
  saveCommunicationAutopilotDecision: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/communication/telegram-booking-object-memory', async () => {
  const actual = await vi.importActual<typeof import('@/lib/communication/telegram-booking-object-memory')>(
    '@/lib/communication/telegram-booking-object-memory',
  );
  return {
    ...actual,
    lookup_booking_by_telegram: (...args: unknown[]) => mockLookupBooking(...args),
    resolveTelegramGuestBookingObjectContext: (...args: unknown[]) => mockResolveGuestContext(...args),
    lookup_property_by_booking: (...args: unknown[]) => mockLookupProperty(...args),
    bookingObjectContextToAutopilotFields: () => ({
      bookingVerified: true,
      propertyResolved: true,
      object: {
        id: 'pilot-smoke-prop',
        name: 'Пилотный объект ASI',
        address: 'Казань, ул. Баумана, 1',
      },
    }),
  };
});

vi.mock('@/lib/crm/repository', () => ({
  attachTelegramToPilotContact: (...args: unknown[]) => mockAttachTelegramToPilotContact(...args),
  upsertCrmContactFromTelegram: (...args: unknown[]) => mockUpsertCrmContactFromTelegram(...args),
  recordCrmCommunicationEvent: (...args: unknown[]) => mockRecordCrmCommunicationEvent(...args),
  recordCrmEventFromOwnerNotification: (...args: unknown[]) => mockRecordCrmEventFromOwnerNotification(...args),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  },
}));

import {
  __resetTelegramRoutingSessionsForTests,
  getTelegramRoutingSession,
} from '@/lib/communication/telegram-routing-session';
import {
  __resetTelegramIdentityMemoryForTests,
  loadTelegramConversationMemory,
} from '@/lib/communication/telegram-identity-memory';
import { processTelegramRoutingUpdate } from '@/lib/communication/telegram-routing';

const PROPERTY_ID = 'pilot-smoke-prop';
const SETUP_SECTION_NAV = [
  { anchor: 'basic', label: 'Основная информация' },
  { anchor: 'address', label: 'Адрес' },
  { anchor: 'units', label: 'Категории/юниты' },
  { anchor: 'photos', label: 'Фото' },
  { anchor: 'description', label: 'Описание' },
  { anchor: 'rules', label: 'Правила проживания' },
  { anchor: 'checkin', label: 'Заезд и выезд' },
  { anchor: 'wifi', label: 'Wi-Fi и инструкции' },
  { anchor: 'pricing', label: 'Цены и базовый тариф' },
  { anchor: 'channels', label: 'Каналы для подключения' },
  { anchor: 'readiness', label: 'Проверка готовности' },
] as const;

const property: OpsProperty = {
  id: PROPERTY_ID,
  accountId: 'acct-1',
  title: 'Пилотный объект',
  address: 'Казань, ул. Баумана, 1',
  city: 'Казань',
  timezone: 'Europe/Moscow',
  status: 'draft',
  createdAt: '2026-06-16T00:00:00.000Z',
  updatedAt: '2026-06-16T00:00:00.000Z',
};

const masterCard: PropertyMasterCard = {
  id: 'card-1',
  propertyId: PROPERTY_ID,
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

const photo: PropertyMedia = {
  id: 'photo-1',
  propertyId: PROPERTY_ID,
  url: 'https://example.com/photo.jpg',
  storagePath: null,
  title: null,
  description: null,
  sortOrder: 0,
  isCover: true,
  status: 'active',
  createdAt: '2026-06-16T00:00:00.000Z',
  updatedAt: '2026-06-16T00:00:00.000Z',
};

function readySetup() {
  const setup = createEmptySetupData();
  setup.basic.city = 'Казань';
  setup.address.line = 'ул. Баумана, 1';
  setup.checkInOut.checkInInstructions = 'Код 1234';
  setup.wifi.wifiName = 'ASI-Guest';
  setup.wifi.wifiPassword = 'wifi-secret';
  setup.rules.smoking = 'Курение запрещено';
  setup.description.full = 'Уютная квартира.';
  return setup;
}

function readyReadiness() {
  return computeObjectGuestReadiness({
    propertyId: PROPERTY_ID,
    property,
    masterCard,
    setup: readySetup(),
    media: [photo],
  });
}

function routingUpdate(text: string, update_id = 9000) {
  const update = tgTextUpdate({
    chat_id: 91001,
    user_id: 92001,
    update_id,
    message_id: update_id,
    text,
  });
  update.message!.from = {
    id: 92001,
    username: 'pilot_smoke_guest',
    first_name: 'Гость',
    language_code: 'ru',
  };
  return update;
}

function roleCallback(role: string, update_id = 9001) {
  return {
    update_id,
    callback_query: {
      id: `cb-${update_id}`,
      from: {
        id: 92001,
        username: 'pilot_smoke_guest',
        first_name: 'Гость',
        language_code: 'ru',
      },
      message: {
        message_id: update_id,
        chat: { id: 91001 },
      },
      data: `tr:role:${role}`,
    },
  };
}

const smokeSummary: PilotSmokeBlockResult[] = [];

function recordBlock(block: PilotSmokeBlockResult['block'], run: () => void | Promise<void>) {
  const failures: string[] = [];
  return async () => {
    try {
      await run();
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      smokeSummary.push({ block, pass: false, failures });
      throw error;
    }
    smokeSummary.push({ block, pass: true, failures });
  };
}

describe('pilot acceptance smoke v1', () => {
  beforeEach(() => {
    __resetTelegramRoutingSessionsForTests();
    __resetTelegramIdentityMemoryForTests();
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXT_PUBLIC_URL;

    mockReplyToTelegram.mockReset();
    mockAnswerTelegramCallbackQuery.mockReset();
    mockSendTelegramMessageToChat.mockReset();
    mockBeginLead.mockReset();
    mockBeginSupport.mockReset();
    mockDecideAutopilot.mockReset();
    mockLookupBooking.mockReset();
    mockResolveGuestContext.mockReset();
    mockLookupProperty.mockReset();
    mockLookupGuestTestProperty.mockReset();
    mockUpsertCrmContactFromTelegram.mockReset();
    mockRecordCrmCommunicationEvent.mockReset();
    mockRecordCrmEventFromOwnerNotification.mockReset();
    mockAttachTelegramToPilotContact.mockReset();
    mockLoadObjectGuestReadiness.mockReset();

    mockReplyToTelegram.mockResolvedValue(true);
    mockAnswerTelegramCallbackQuery.mockResolvedValue(true);
    mockSendTelegramMessageToChat.mockResolvedValue(true);
    mockUpsertCrmContactFromTelegram.mockResolvedValue({});
    mockRecordCrmCommunicationEvent.mockResolvedValue(undefined);
    mockRecordCrmEventFromOwnerNotification.mockResolvedValue(undefined);
    mockAttachTelegramToPilotContact.mockResolvedValue(null);
    mockLoadObjectGuestReadiness.mockResolvedValue({
      found: true,
      readiness: {
        propertyId: PROPERTY_ID,
        isReady: true,
        items: [],
        completedCount: 7,
        totalCount: 7,
        nextItem: null,
        guestTestDeepLink: `https://t.me/ASI_Global_Bot?start=guest_test_${PROPERTY_ID}`,
        guestTestCommand: `/guest_test ${PROPERTY_ID}`,
        statusMessage: 'ready',
      },
    });
    mockLookupBooking.mockResolvedValue(null);
    mockResolveGuestContext.mockResolvedValue({
      booking_resolved: false,
      property_resolved: false,
      access_verified: false,
      wifi_verified: false,
      lookup_reason: 'no_match',
    });
    mockLookupProperty.mockResolvedValue({
      object_id: PROPERTY_ID,
      object_name: 'Пилотный объект ASI',
      address: 'Казань, ул. Баумана, 1',
      directions_text: 'Вход со двора.',
      check_in_text: 'Заезд с 15:00.',
      checkout_time: '12:00',
      wifi_name: 'ASI-Guest',
      wifi_password: 'wifi-secret',
      house_rules_text: 'Курение запрещено.',
    });
    mockLookupGuestTestProperty.mockResolvedValue({
      object_id: PROPERTY_ID,
      object_name: 'Пилотный объект ASI',
      address: 'Казань, ул. Баумана, 1',
      directions_text: 'Вход со двора.',
      check_in_text: 'Заезд с 15:00.',
      checkout_time: '12:00',
      wifi_name: 'ASI-Guest',
      wifi_password: 'wifi-secret',
      house_rules_text: 'Курение запрещено.',
    });
    mockDecideAutopilot.mockResolvedValue({
      action: 'auto_reply',
      confidence: 0.92,
      replyText: 'fallback',
      metadata: { intent: 'unknown', missingContext: [], matchedSignals: [], policy: [] },
    });
  });

  afterAll(() => {
    // eslint-disable-next-line no-console
    console.log(formatPilotSmokeSummary(smokeSummary));
  });

  it(
    'setup readiness',
    recordBlock('setup', () => {
      const readiness = readyReadiness();
      const ui = resolveSetupReadinessPageUi({
        activeStepId: 'readiness',
        readiness,
        telegramLinked: false,
        guestTestDispatched: false,
      });

      expect(shouldShowSetupNextButton('readiness')).toBe(false);
      expect(ui.showNextButton).toBe(false);
      expect(shouldShowTopReadinessBlock('readiness')).toBe(false);
      expect(ui.showTopReadinessBlock).toBe(false);
      expect(filterSetupStepsForGrid(SETUP_SECTION_NAV).map((step) => step.anchor)).not.toContain('readiness');
      expect(getSetupFillableStepCount(SETUP_SECTION_NAV)).toBe(10);
      expect(
        resolveSetupProgressCounts({
          completedFillableSections: 10,
          fillableStepCount: getSetupFillableStepCount(SETUP_SECTION_NAV),
        }),
      ).toEqual({ completedStepCount: 10, totalStepCount: 10 });
      expect(ui.primaryCtaPlacements).toEqual(['sticky']);
      expect(ui.stickyPrimaryCta?.label).toBe('Запустить тест гостя в Telegram');
      expect(ui.stickyPrimaryCta?.kind).toBe('launch_guest_test');

      const setupPath = `/dashboard/properties/${PROPERTY_ID}/setup?step=readiness`;
      expect(toAppPath(setupPath)).toBe(setupPath);
    }),
  );

  it(
    'link/redirect',
    recordBlock('link/redirect', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'http://dashboard';
      const setupPath = `/dashboard/properties/${PROPERTY_ID}/setup?step=readiness`;
      const absolute = toAppAbsoluteUrl(setupPath);

      expect(containsBogusDashboardOrigin(absolute)).toBe(false);
      expect(absolute).toBe(`https://asi-global.ru${setupPath}`);
      expect(toAppPath('http://dashboard/dashboard/properties/prop-1/setup')).toBe(
        '/dashboard/properties/prop-1/setup',
      );
    }),
  );

  it(
    'telegram memory',
    recordBlock('telegram memory', async () => {
      await processTelegramRoutingUpdate(routingUpdate(`/start guest_test_${PROPERTY_ID}`, 9010));
      await Promise.resolve();

      const memory = await loadTelegramConversationMemory('92001');
      expect(memory?.activeScenario).toBe('guest_test');
      expect(memory?.propertyId).toBe(PROPERTY_ID);
      expect(memory?.guestTestActive).toBe(true);
      expect(memory?.telegramUserId).toBe('92001');
      expect(memory?.chatId).toBe(91001);
      expect(getTelegramRoutingSession(91001)?.testGuest).toBe(true);

      __resetTelegramRoutingSessionsForTests();
      mockReplyToTelegram.mockClear();

      const resume = await processTelegramRoutingUpdate(routingUpdate('/start', 9011));
      expect(resume?.reply).toContain('Тест гостя уже включён');
      expect(JSON.stringify(mockReplyToTelegram.mock.calls.at(-1)?.[3] ?? {})).not.toContain(
        'Я гость по бронированию',
      );

      mockReplyToTelegram.mockClear();
      await processTelegramRoutingUpdate(roleCallback('guest', 9012));
      expect(getTelegramRoutingSession(91001)?.testGuest).toBe(true);
      expect(mockReplyToTelegram).toHaveBeenCalledWith(
        91001,
        expect.stringContaining('Тест гостя уже включён'),
        expect.any(Object),
        expect.any(Object),
      );
    }),
  );

  it(
    'property answers',
    recordBlock('property answers', async () => {
      await processTelegramRoutingUpdate(routingUpdate(`/start guest_test_${PROPERTY_ID}`, 9020));
      mockReplyToTelegram.mockClear();
      mockRecordCrmCommunicationEvent.mockClear();

      await processTelegramRoutingUpdate(routingUpdate('какой адрес?', 9021));
      expect(mockDecideAutopilot).not.toHaveBeenCalled();
      const addressReply = String(mockReplyToTelegram.mock.calls.at(-1)?.[1] ?? '');
      expect(addressReply).toContain('Баумана');
      expect(addressReply).not.toMatch(/оператор/i);

      await processTelegramRoutingUpdate(routingUpdate('какой Wi-Fi?', 9022));
      const wifiReply = String(mockReplyToTelegram.mock.calls.at(-1)?.[1] ?? '');
      expect(wifiReply).toContain('ASI-Guest');
      expect(wifiReply).not.toMatch(/оператор/i);

      await processTelegramRoutingUpdate(routingUpdate('можно курить?', 9023));
      const smokingReply = String(mockReplyToTelegram.mock.calls.at(-1)?.[1] ?? '');
      expect(smokingReply).toMatch(/курить.*нельзя/i);
      expect(smokingReply).not.toMatch(/оператор/i);
    }),
  );

  it(
    'CRM events',
    recordBlock('CRM events', async () => {
      mockRecordCrmCommunicationEvent.mockClear();

      await processTelegramRoutingUpdate(routingUpdate(`/start guest_test_${PROPERTY_ID}`, 9030));
      expect(mockRecordCrmCommunicationEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'guest_test_started', propertyId: PROPERTY_ID }),
      );

      const setup = readySetup();
      const summary = buildCrmPropertyAutomationSummary({
        property,
        masterCard,
        setup,
        media: [photo],
      });
      const afterStart = deriveCrmAutomationSuggestion({
        role: 'owner',
        status: 'testing_communication',
        source: 'pilot_form',
        propertyId: PROPERTY_ID,
        explicitNextAction: 'Проверить результат теста гостя',
        propertySummary: summary,
      });
      expect(afterStart.suggestedNextAction).toBe('Проверить результат теста гостя');

      const readyObject = deriveCrmAutomationSuggestion({
        role: 'owner',
        status: 'object_filled',
        source: 'pilot_form',
        propertyId: PROPERTY_ID,
        explicitNextAction: '',
        propertySummary: summary,
      });
      expect(readyObject.suggestedNextAction).toBe('Запустить тест гостя');
      expect(String(readyObject.nextActionHref ?? '')).toContain(`guest_test_${PROPERTY_ID}`);

      mockReplyToTelegram.mockClear();
      mockRecordCrmCommunicationEvent.mockClear();
      mockSendTelegramMessageToChat.mockClear();

      await processTelegramRoutingUpdate(routingUpdate('какой адрес?', 9031));
      const eventTypes = mockRecordCrmCommunicationEvent.mock.calls.map(
        (call) => (call[0] as { eventType?: string }).eventType,
      );
      expect(eventTypes).not.toContain('operator_followup_required');
      expect(mockRecordCrmCommunicationEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'guest_test_question',
          metadata: expect.objectContaining({ outcome: 'answered_from_property_data' }),
        }),
      );
    }),
  );
});
