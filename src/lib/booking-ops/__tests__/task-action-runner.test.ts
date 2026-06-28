import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runBookingOpsTaskAction } from '../task-action-runner';
import type { BookingOpsTask } from '../task-types';
import type {
  BookingOpsRecord,
  BookingOpsTelegramDraft,
  BookingOpsTelegramDraftActionId,
} from '../types';

const sendMessage = vi.fn();
const draftStore: BookingOpsTelegramDraft[] = [];
const insertDraft = vi.fn();

vi.mock('@/lib/telegram', () => ({
  replyToTelegram: sendMessage,
  sendTelegramMessage: sendMessage,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'booking_ops_telegram_drafts') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(async () => ({
              data: draftStore.map((draft) => ({ status: draft.status })),
              error: null,
            })),
          })),
        };
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(async () => ({ data: [], error: null })),
        })),
      };
    }),
  },
}));

vi.mock('../telegram-drafts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../telegram-drafts')>();
  return {
    ...actual,
    listBookingOpsTelegramDrafts: vi.fn(async (recordId: string) => ({
      ok: true as const,
      drafts: draftStore.filter((draft) => draft.bookingOpsRecordId === recordId),
    })),
    createTelegramDraftFromBookingOpsAction: vi.fn(
      async (recordId: string, actionId: string, options?: { createdBy?: string | null }) => {
        const existing = draftStore.find(
          (draft) =>
            draft.bookingOpsRecordId === recordId
            && draft.actionId === actionId
            && (draft.status === 'draft' || draft.status === 'copied'),
        );
        if (existing) {
          return { ok: true as const, draft: existing };
        }
        const draft: BookingOpsTelegramDraft = {
          id: `draft-${actionId}-${draftStore.length + 1}`,
          bookingOpsRecordId: recordId,
          sourceBookingId: 'res-1',
          telegramChatId: '920001',
          telegramTarget: 'tg_920001',
          actionId: actionId as BookingOpsTelegramDraftActionId,
          messageText: `Текст черновика для ${actionId}`,
          status: 'draft',
          createdBy: options?.createdBy ?? null,
          warning: null,
          metadata: {},
          createdAt: '2026-06-28T10:00:00.000Z',
          updatedAt: '2026-06-28T10:00:00.000Z',
        };
        draftStore.push(draft);
        insertDraft(draft);
        return { ok: true as const, draft };
      },
    ),
  };
});

function baseRecord(overrides: Partial<BookingOpsRecord> = {}): BookingOpsRecord {
  return {
    id: 'ops-1',
    bookingId: 'res-1',
    guestName: 'Иван Петров',
    guestPhone: '+79990000001',
    guestEmail: null,
    guestTelegram: 'tg_920001',
    propertyId: 'OBJ-1',
    propertyLabel: 'Апартаменты',
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
    notes: null,
    guestCount: 2,
    paymentStatus: 'paid',
    documentRequired: true,
    documentCollected: false,
    documentVerificationStatus: 'missing',
    documentNotes: null,
    contractRequired: true,
    contractProvider: 'manual',
    contractIntakeStatus: 'missing',
    contractLink: null,
    contractNotes: null,
    depositRequired: true,
    depositAmount: 5000,
    depositIntakeStatus: 'missing',
    depositPaymentMethod: null,
    depositNotes: null,
    mvdRequired: false,
    mvdDataStatus: 'not_required',
    mvdConfirmationLink: null,
    mvdNotes: null,
    createdAt: '2026-06-28T08:00:00.000Z',
    updatedAt: '2026-06-28T08:00:00.000Z',
    ...overrides,
  };
}

function openTask(taskType: BookingOpsTask['taskType'], id = 'task-1'): BookingOpsTask {
  return {
    id,
    bookingOpsRecordId: 'ops-1',
    bookingId: 'res-1',
    taskType,
    title: taskType,
    description: null,
    status: 'open',
    priority: 'normal',
    source: 'readiness_gate',
    dueAt: null,
    completedAt: null,
    metadata: {},
    createdAt: '2026-06-28T08:00:00.000Z',
    updatedAt: '2026-06-28T08:00:00.000Z',
  };
}

describe('runBookingOpsTaskAction', () => {
  beforeEach(() => {
    draftStore.length = 0;
    sendMessage.mockClear();
    insertDraft.mockClear();
  });

  it('request_guest_documents creates a manual Telegram draft', async () => {
    const record = baseRecord();
    const result = await runBookingOpsTaskAction(record, openTask('request_guest_documents'));

    expect(result.ok).toBe(true);
    expect(result.createdDraftIds).toHaveLength(1);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('repeated request_guest_documents does not duplicate draft', async () => {
    const record = baseRecord();
    const task = openTask('request_guest_documents');

    const first = await runBookingOpsTaskAction(record, task);
    const second = await runBookingOpsTaskAction(record, task);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.createdDraftIds).toEqual(first.createdDraftIds);
    expect(draftStore.filter((draft) => draft.actionId === 'request_guest_documents')).toHaveLength(1);
    expect(insertDraft).toHaveBeenCalledOnce();
  });

  it('send_contract_manual is blocked if contract is not prepared', async () => {
    const record = baseRecord({
      documentsStatus: 'verified',
      documentVerificationStatus: 'verified',
      documentCollected: true,
      contractStatus: 'not_started',
      contractIntakeStatus: 'missing',
    });
    const result = await runBookingOpsTaskAction(record, openTask('send_contract_manual'));

    expect(result.ok).toBe(false);
    expect(result.blockingReason).toBeTruthy();
    expect(result.createdDraftIds).toBeNull();
    expect(insertDraft).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('request_deposit creates deposit request draft or checklist path', async () => {
    const record = baseRecord({
      documentsStatus: 'verified',
      documentVerificationStatus: 'verified',
      documentCollected: true,
      contractStatus: 'signed',
      contractIntakeStatus: 'signed',
      depositRequired: true,
      depositIntakeStatus: 'missing',
    });
    const result = await runBookingOpsTaskAction(record, openTask('request_deposit'));

    expect(result.ok).toBe(true);
    expect(result.createdDraftIds).toHaveLength(1);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('collect_mvd_data creates MVD checklist', async () => {
    const record = baseRecord({
      mvdRequired: true,
      mvdDataStatus: 'missing',
      mvdStatus: 'required',
    });
    const result = await runBookingOpsTaskAction(record, openTask('collect_mvd_data'));

    expect(result.ok).toBe(true);
    expect(result.checklist?.length).toBeGreaterThan(2);
    expect(result.createdDraftIds).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('generate_telegram_drafts respects readiness gate', async () => {
    const record = baseRecord({
      guestName: '',
      documentRequired: true,
      documentVerificationStatus: 'missing',
    });
    const result = await runBookingOpsTaskAction(record, openTask('generate_telegram_drafts'));

    expect(result.ok).toBe(false);
    expect(result.blockingReason).toBeTruthy();
    expect(insertDraft).not.toHaveBeenCalled();
  });

  it('manual_send_telegram_drafts does not call sendMessage', async () => {
    draftStore.push({
      id: 'draft-existing',
      bookingOpsRecordId: 'ops-1',
      sourceBookingId: 'res-1',
      telegramChatId: '920001',
      telegramTarget: 'tg_920001',
      actionId: 'request_guest_documents',
      messageText: 'Тест',
      status: 'copied',
      createdBy: null,
      warning: null,
      metadata: {},
      createdAt: '2026-06-28T10:00:00.000Z',
      updatedAt: '2026-06-28T10:00:00.000Z',
    });

    const record = baseRecord({
      documentsStatus: 'verified',
      documentVerificationStatus: 'verified',
      documentCollected: true,
      contractStatus: 'signed',
      contractIntakeStatus: 'signed',
      depositStatus: 'confirmed',
      depositIntakeStatus: 'received',
    });
    const result = await runBookingOpsTaskAction(
      record,
      openTask('manual_send_telegram_drafts'),
    );

    expect(result.ok).toBe(true);
    expect(result.message).toContain('sendMessage');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('action runner is idempotent for generate_telegram_drafts', async () => {
    const record = baseRecord({
      documentsStatus: 'verified',
      documentVerificationStatus: 'verified',
      documentCollected: true,
      contractStatus: 'signed',
      contractIntakeStatus: 'signed',
      depositStatus: 'confirmed',
      depositIntakeStatus: 'received',
      depositRequired: true,
      mvdRequired: false,
      mvdDataStatus: 'not_required',
    });
    const task = openTask('generate_telegram_drafts');

    const first = await runBookingOpsTaskAction(record, task);
    const countAfterFirst = draftStore.length;
    const second = await runBookingOpsTaskAction(record, task);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(draftStore.length).toBe(countAfterFirst);
  });
});

describe('runBookingOpsTaskAction invalid cases', () => {
  beforeEach(() => {
    draftStore.length = 0;
    sendMessage.mockClear();
  });

  it('returns blocking result for unknown task type via default branch', async () => {
    const record = baseRecord();
    const task = {
      ...openTask('request_guest_documents'),
      taskType: 'not_a_real_type' as BookingOpsTask['taskType'],
    };
    const result = await runBookingOpsTaskAction(record, task);

    expect(result.ok).toBe(false);
    expect(result.blockingReason).toBe('invalid_task_type');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('never calls external Telegram send', async () => {
    const record = baseRecord();
    const actions: BookingOpsTask['taskType'][] = [
      'request_guest_documents',
      'request_deposit',
      'collect_mvd_data',
      'manual_send_telegram_drafts',
    ];

    for (const taskType of actions) {
      await runBookingOpsTaskAction(record, openTask(taskType, `task-${taskType}`));
    }

    expect(sendMessage).not.toHaveBeenCalled();
  });
});
