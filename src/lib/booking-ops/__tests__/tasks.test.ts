import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingOpsRecord } from '../types';

const sendMessage = vi.fn();
const store = new Map<string, Record<string, unknown>>();

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
            eq: vi.fn(async () => ({ data: [], error: null })),
          })),
        };
      }
      if (table !== 'booking_ops_tasks') {
        return {
          select: vi.fn(() => ({ eq: vi.fn(async () => ({ data: [], error: null })) })),
          update: vi.fn(() => ({ eq: vi.fn(async () => ({ data: null, error: null })) })),
        };
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn((col: string, recordId: string) => {
            const rowsForRecord = () =>
              [...store.values()].filter((row) => row.booking_ops_record_id === recordId);
            return {
              eq: vi.fn((_col2: string, taskType: string) => ({
                in: vi.fn(() => ({
                  order: vi.fn(() => ({
                    limit: vi.fn(() => ({
                      maybeSingle: vi.fn(async () => ({
                        data:
                          rowsForRecord().find(
                            (row) =>
                              row.task_type === taskType
                              && ['open', 'in_progress', 'blocked'].includes(String(row.status)),
                          ) ?? null,
                        error: null,
                      })),
                    })),
                  })),
                })),
                order: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    maybeSingle: vi.fn(async () => {
                      const match = rowsForRecord().find((row) => row.task_type === taskType);
                      return { data: match ?? null, error: null };
                    }),
                  })),
                })),
              })),
              in: vi.fn(async (_col: string, statuses: string[]) => ({
                data: rowsForRecord().filter((row) => statuses.includes(String(row.status))),
                error: null,
              })),
              order: vi.fn(async () => ({ data: rowsForRecord(), error: null })),
            };
          }),
        })),
        insert: vi.fn((row: Record<string, unknown>) => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => {
              store.set(String(row.id), row);
              return { data: row, error: null };
            }),
          })),
        })),
        update: vi.fn((patch: Record<string, unknown>) => ({
          eq: vi.fn((_col: string, id: string) => ({
            in: vi.fn(async (_c: string, ids: string[]) => {
              for (const taskId of ids) {
                const existing = store.get(taskId);
                if (existing) store.set(taskId, { ...existing, ...patch });
              }
              return { data: null, error: null };
            }),
            select: vi.fn(() => ({
              maybeSingle: vi.fn(async () => {
                const existing = store.get(id);
                if (existing) store.set(id, { ...existing, ...patch });
                return { data: store.get(id), error: null };
              }),
            })),
          })),
        })),
      };
    }),
  },
}));

function readyBooking(overrides: Partial<BookingOpsRecord> = {}): BookingOpsRecord {
  return {
    id: 'ops-ready',
    bookingId: 'reservation-ready',
    guestName: 'Анна Смирнова',
    guestPhone: '+79990000002',
    guestEmail: null,
    guestTelegram: 'tg_920002',
    propertyId: 'OBJ-2',
    propertyLabel: 'Студия у метро',
    otaSource: 'avito',
    checkInAt: '2026-08-01T14:00:00.000Z',
    checkOutAt: '2026-08-03T11:00:00.000Z',
    opsStatus: 'created',
    manualNextAction: null,
    isBlocked: false,
    blockerReason: null,
    documentsStatus: 'requested',
    contractStatus: 'signed',
    depositStatus: 'confirmed',
    mvdStatus: 'not_required',
    checkinReadinessStatus: 'not_started',
    unitReadinessStatus: 'not_ready',
    notes: null,
    guestCount: 2,
    paymentStatus: 'paid',
    documentRequired: true,
    documentCollected: false,
    documentVerificationStatus: 'missing',
    documentNotes: null,
    contractRequired: true,
    contractProvider: 'manual',
    contractIntakeStatus: 'signed',
    contractLink: 'https://example.com/contract',
    contractNotes: null,
    depositRequired: true,
    depositAmount: 5000,
    depositIntakeStatus: 'received',
    depositPaymentMethod: 'card',
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

describe('applyBookingOpsTaskSync', () => {
  beforeEach(() => {
    store.clear();
    sendMessage.mockClear();
  });

  it('task sync is idempotent and does not create duplicates', async () => {
    const { applyBookingOpsTaskSync } = await import('../tasks');
    const record = readyBooking();

    const first = await applyBookingOpsTaskSync(record);
    expect(first.ok).toBe(true);
    const openTasks = first.tasks.filter((task) => task.status === 'open');
    expect(openTasks.filter((task) => task.taskType === 'request_guest_documents')).toHaveLength(1);
    expect(openTasks.filter((task) => task.taskType === 'cleaning_needed')).toHaveLength(1);

    const second = await applyBookingOpsTaskSync(record);
    expect(second.ok).toBe(true);
    expect(
      second.tasks.filter(
        (task) => task.taskType === 'request_guest_documents' && task.status === 'open',
      ),
    ).toHaveLength(1);
    expect(
      second.tasks.filter(
        (task) => task.taskType === 'cleaning_needed' && task.status === 'open',
      ),
    ).toHaveLength(1);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('completed tasks are not reopened on sync', async () => {
    const { applyBookingOpsTaskSync } = await import('../tasks');
    const record = readyBooking();

    await applyBookingOpsTaskSync(record);
    const taskId = [...store.keys()][0];
    store.set(taskId, {
      ...store.get(taskId)!,
      status: 'completed',
      completed_at: new Date().toISOString(),
    });

    const again = await applyBookingOpsTaskSync(record);
    expect(
      again.tasks.filter(
        (task) => task.taskType === 'request_guest_documents' && task.status === 'completed',
      ),
    ).toHaveLength(1);
    expect(
      again.tasks.filter(
        (task) => task.taskType === 'request_guest_documents' && task.status === 'open',
      ),
    ).toHaveLength(0);
  });
});
