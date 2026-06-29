import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTelegramDraftFromBookingOpsAction } from '../telegram-drafts';
import type {
  BookingOpsRecord,
  BookingOpsTelegramDraft,
  BookingOpsTelegramDraftActionId,
} from '../types';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(async () => ({ data: [], error: null })),
      })),
    })),
  },
}));

const sendMessage = vi.fn();
vi.mock('@/lib/telegram', () => ({
  replyToTelegram: sendMessage,
  sendTelegramMessage: sendMessage,
}));

const baseRecord: BookingOpsRecord = {
  id: 'ops-1',
  bookingId: 'reservation-1',
  guestName: 'Иван Петров',
  guestPhone: '+79990000001',
  guestEmail: null,
  guestTelegram: 'tg_920001',
  propertyId: 'OBJ-1',
  propertyLabel: 'Апартаменты на Невском',
  otaSource: 'avito',
  checkInAt: '2026-07-01T14:00:00.000Z',
  checkOutAt: '2026-07-03T11:00:00.000Z',
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
  notes: 'Не менять заметку оператора',
  guestCount: 2,
  paymentStatus: 'paid',
  documentRequired: null,
  documentCollected: null,
  documentVerificationStatus: null,
  documentNotes: null,
  contractRequired: null,
  contractProvider: null,
  contractIntakeStatus: null,
  contractLink: null,
  contractNotes: null,
  depositRequired: null,
  depositAmount: null,
  depositIntakeStatus: null,
  depositPaymentMethod: null,
  depositNotes: null,
  mvdRequired: null,
  mvdDataStatus: null,
  mvdConfirmationLink: null,
  mvdNotes: null,
  createdAt: '2026-06-27T08:00:00.000Z',
  updatedAt: '2026-06-27T08:00:00.000Z',
};

function recordForAction(actionId: BookingOpsTelegramDraftActionId): BookingOpsRecord {
  const intake = {
    guestCount: 2,
    paymentStatus: 'paid',
    documentRequired: true,
    documentCollected: true,
    documentVerificationStatus: 'verified' as const,
    contractRequired: true,
    contractProvider: 'manual' as const,
    depositRequired: true,
    mvdRequired: false,
    mvdDataStatus: 'not_required' as const,
  };
  switch (actionId) {
    case 'request_guest_documents':
      return { ...baseRecord, ...intake, documentVerificationStatus: null, documentsStatus: 'not_started' };
    case 'send_contract':
      return {
        ...baseRecord,
        ...intake,
        documentsStatus: 'verified',
        contractStatus: 'prepared',
        contractIntakeStatus: 'prepared',
      };
    case 'request_deposit':
      return {
        ...baseRecord,
        ...intake,
        documentsStatus: 'verified',
        contractStatus: 'signed',
        contractIntakeStatus: 'signed',
        depositRequired: true,
      };
    case 'prepare_checkin_instructions':
      return {
        ...baseRecord,
        ...intake,
        documentsStatus: 'verified',
        contractStatus: 'signed',
        contractIntakeStatus: 'signed',
        depositStatus: 'confirmed',
        depositIntakeStatus: 'received',
        checkinReadinessStatus: 'in_progress',
      };
    default:
      return baseRecord;
  }
}

function draftFromInput(input: {
  id: string;
  bookingOpsRecordId: string;
  sourceBookingId: string | null;
  telegramChatId: string | null;
  telegramTarget: string | null;
  actionId: BookingOpsTelegramDraftActionId;
  messageText: string;
  createdBy: string | null;
  warning: string | null;
  metadata: Record<string, unknown>;
}): BookingOpsTelegramDraft {
  return {
    id: input.id,
    bookingOpsRecordId: input.bookingOpsRecordId,
    sourceBookingId: input.sourceBookingId,
    telegramChatId: input.telegramChatId,
    telegramTarget: input.telegramTarget,
    actionId: input.actionId,
    messageText: input.messageText,
    status: 'draft',
    createdBy: input.createdBy,
    warning: input.warning,
    metadata: input.metadata,
    createdAt: '2026-06-28T08:00:00.000Z',
    updatedAt: '2026-06-28T08:00:00.000Z',
  };
}

function dependenciesFor(
  record: BookingOpsRecord,
  target: { chatId: string | null; target: string | null; warning: string | null } = {
    chatId: '920001',
    target: 'tg_920001',
    warning: null,
  },
) {
  const insertDraft = vi.fn(async (input: Parameters<typeof draftFromInput>[0]) => ({
    ok: true as const,
    draft: draftFromInput(input),
  }));
  const syncTasks = vi.fn(async () => ({ ok: true as const }));
  return {
    dependencies: {
      getRecord: vi.fn(async () => record),
      resolveTarget: vi.fn(async () => target),
      insertDraft,
      syncTasks,
    },
    insertDraft,
    syncTasks,
  };
}

describe('Booking Ops Telegram Draft Handoff v1', () => {
  beforeEach(() => {
    sendMessage.mockClear();
  });

  for (const actionId of [
    'request_guest_documents',
    'send_contract',
    'request_deposit',
  ] as const) {
    it(`creates a copy-ready draft for ${actionId}`, async () => {
      const record = recordForAction(actionId);
      const before = structuredClone(record);
      const { dependencies, insertDraft, syncTasks } = dependenciesFor(record);

      const result = await createTelegramDraftFromBookingOpsAction(
        record.id,
        actionId,
        { createdBy: 'operator@asi.test' },
        dependencies,
      );

      expect(result.ok).toBe(true);
      expect(insertDraft).toHaveBeenCalledOnce();
      const input = insertDraft.mock.calls[0][0];
      expect(input.actionId).toBe(actionId);
      expect(input.messageText.length).toBeGreaterThan(20);
      expect(input.sourceBookingId).toBe('reservation-1');
      expect(syncTasks).toHaveBeenCalledOnce();
      expect(record).toEqual(before);
      expect(record.notes).toBe('Не менять заметку оператора');
      expect(sendMessage).not.toHaveBeenCalled();
    });
  }

  it('creates check-in instructions from property knowledge without private notes', async () => {
    const record: BookingOpsRecord = {
      ...recordForAction('prepare_checkin_instructions'),
      propertyKnowledgeMatch: 'property_id',
      propertyKnowledge: {
        propertyId: 'OBJ-1', propertyLabel: 'Апартаменты',
        address: 'Невский проспект, 10', entranceInstructions: 'Вход со двора',
        floorApartment: '3 этаж, квартира 12', intercomCode: '12',
        keyPickupInstructions: 'Ключ в боксе', wifiName: 'ASI-Guest',
        wifiPassword: 'test-password', parkingInstructions: 'Во дворе',
        houseRules: 'Не курить', quietHours: '22:00–08:00',
        checkoutInstructions: 'Ключ оставить на столе',
        emergencyInstructions: 'Напишите оператору', cleaningLinenNotes: null,
        publicGuestNotes: 'Сохраните инструкцию', privateOperatorNotes: 'Секрет оператора',
        updatedAt: '2026-06-28T07:00:00.000Z',
      },
    };
    const { dependencies, insertDraft } = dependenciesFor(record);

    const result = await createTelegramDraftFromBookingOpsAction(
      record.id,
      'prepare_checkin_instructions',
      undefined,
      dependencies,
    );

    expect(result.ok).toBe(true);
    const message = insertDraft.mock.calls[0][0].messageText;
    expect(message).toContain('Невский проспект, 10');
    expect(message).toContain('ASI-Guest');
    expect(message).not.toContain('Секрет оператора');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('creates a draft with a warning when Telegram target is missing', async () => {
    const record = { ...baseRecord, guestTelegram: null };
    const warning = 'Чат Telegram не найден.';
    const { dependencies, insertDraft } = dependenciesFor(record, {
      chatId: null,
      target: null,
      warning,
    });

    const result = await createTelegramDraftFromBookingOpsAction(
      record.id,
      'request_guest_documents',
      undefined,
      dependencies,
    );

    expect(result.ok).toBe(true);
    expect(insertDraft.mock.calls[0][0]).toMatchObject({
      telegramChatId: null,
      warning,
    });
  });

  it('rejects a known internal-only action', async () => {
    const { dependencies, insertDraft } = dependenciesFor(baseRecord);
    const result = await createTelegramDraftFromBookingOpsAction(
      baseRecord.id,
      'verify_guest_documents',
      undefined,
      dependencies,
    );

    expect(result).toMatchObject({ ok: false, error: 'action_not_guest_facing' });
    expect(insertDraft).not.toHaveBeenCalled();
  });

  it('rejects an invalid action', async () => {
    const { dependencies, insertDraft } = dependenciesFor(baseRecord);
    const result = await createTelegramDraftFromBookingOpsAction(
      baseRecord.id,
      'send_anything_now',
      undefined,
      dependencies,
    );

    expect(result).toMatchObject({ ok: false, error: 'invalid_action' });
    expect(insertDraft).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('rejects an unavailable guest-facing action without changing booking state', async () => {
    const record = { ...baseRecord, documentsStatus: 'verified' as const };
    const before = structuredClone(record);
    const { dependencies, insertDraft } = dependenciesFor(record);

    const result = await createTelegramDraftFromBookingOpsAction(
      record.id,
      'request_guest_documents',
      undefined,
      dependencies,
    );

    expect(result).toMatchObject({ ok: false, error: 'action_not_available' });
    expect(insertDraft).not.toHaveBeenCalled();
    expect(record).toEqual(before);
  });
});
