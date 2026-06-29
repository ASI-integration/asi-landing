import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingOpsRecord } from '../types';
import type { BookingOpsTask } from '../task-types';

type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {
  booking_ops_records: [],
  booking_ops_tasks: [],
  booking_ops_events: [],
  booking_ops_telegram_drafts: [],
};

class Query {
  private filters: Array<(row: Row) => boolean> = [];
  private operation: 'select' | 'insert' | 'update' = 'select';
  private payload: Row = {};
  private limitCount: number | null = null;
  private orderRules: Array<{ column: string; ascending: boolean }> = [];

  constructor(private readonly table: string) {}

  select(): this { return this; }
  insert(payload: Row): this { this.operation = 'insert'; this.payload = payload; return this; }
  update(payload: Row): this { this.operation = 'update'; this.payload = payload; return this; }
  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  in(column: string, values: readonly unknown[]): this {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  order(column: string, options?: { ascending?: boolean }): this {
    this.orderRules.push({ column, ascending: options?.ascending !== false });
    return this;
  }
  limit(count: number): this { this.limitCount = count; return this; }
  single(): Promise<{ data: Row | null; error: Row | null }> { return this.executeSingle(false); }
  maybeSingle(): Promise<{ data: Row | null; error: Row | null }> { return this.executeSingle(true); }
  then<TResult1 = { data: Row[]; error: Row | null }>(
    onfulfilled?: ((value: { data: Row[]; error: Row | null }) => TResult1 | PromiseLike<TResult1>) | null,
  ): Promise<TResult1> {
    return Promise.resolve(this.executeMany()).then(onfulfilled ?? undefined);
  }

  private filteredRows(): Row[] {
    let rows = [...(tables[this.table] ?? [])].filter((row) => this.filters.every((filter) => filter(row)));
    for (const rule of [...this.orderRules].reverse()) {
      rows = rows.sort((a, b) => {
        const left = String(a[rule.column] ?? '');
        const right = String(b[rule.column] ?? '');
        return left.localeCompare(right) * (rule.ascending ? 1 : -1);
      });
    }
    return this.limitCount == null ? rows : rows.slice(0, this.limitCount);
  }

  private executeMany(): { data: Row[]; error: Row | null } {
    if (this.operation === 'insert') {
      const rows = tables[this.table] ?? (tables[this.table] = []);
      if (
        this.table === 'booking_ops_events'
        && this.payload.dedupe_key
        && rows.some((row) => (
          row.booking_ops_record_id === this.payload.booking_ops_record_id
          && row.dedupe_key === this.payload.dedupe_key
        ))
      ) {
        return { data: [], error: { code: '23505', message: 'duplicate' } };
      }
      rows.push({ ...this.payload });
      return { data: [{ ...this.payload }], error: null };
    }
    if (this.operation === 'update') {
      const rows = this.filteredRows();
      rows.forEach((row) => Object.assign(row, this.payload));
      return { data: rows.map((row) => ({ ...row })), error: null };
    }
    return { data: this.filteredRows().map((row) => ({ ...row })), error: null };
  }

  private async executeSingle(_allowEmpty: boolean): Promise<{ data: Row | null; error: Row | null }> {
    const result = this.executeMany();
    return { data: result.data[0] ?? null, error: result.error };
  }
}

const sendMessage = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (table: string) => new Query(table) },
}));

vi.mock('@/lib/telegram', () => ({
  replyToTelegram: sendMessage,
  sendMessage,
  sendTelegramMessage: sendMessage,
}));

vi.mock('../property-knowledge', () => ({
  lookupPropertyKnowledge: vi.fn(async () => ({ knowledge: null, match: 'none' })),
  lookupPropertyKnowledgeBatch: vi.fn(async (items: Array<{ key: string }>) => new Map(
    items.map((item) => [item.key, { knowledge: null, match: 'none' }]),
  )),
}));

function eventRows(type?: string): Row[] {
  return tables.booking_ops_events.filter((row) => !type || row.event_type === type);
}

function createInput() {
  return {
    guestName: 'Тестовый гость',
    guestPhone: '+79990000000',
    guestTelegram: 'tg_900001',
    propertyId: 'property-test',
    propertyLabel: 'Тестовые апартаменты',
    otaSource: 'manual',
    checkInAt: '2026-07-10T14:00:00.000Z',
    checkOutAt: '2026-07-12T11:00:00.000Z',
    guestCount: 2,
    paymentStatus: 'paid',
    documentRequired: true,
    documentCollected: false,
    documentVerificationStatus: 'missing' as const,
    contractRequired: false,
    contractProvider: 'none' as const,
    contractIntakeStatus: 'not_required' as const,
    depositRequired: false,
    depositIntakeStatus: 'not_required' as const,
    mvdRequired: false,
    mvdDataStatus: 'not_required' as const,
  };
}

async function createRecord(): Promise<BookingOpsRecord> {
  const { createBookingOpsRecord } = await import('../repository');
  const result = await createBookingOpsRecord(createInput(), { actorType: 'admin' });
  expect(result.ok).toBe(true);
  return result.record!;
}

describe('Booking Ops timeline', () => {
  beforeEach(() => {
    Object.values(tables).forEach((rows) => rows.splice(0));
    sendMessage.mockClear();
  });

  it('records booking creation and automatic task creation', async () => {
    await createRecord();

    expect(eventRows('booking_created')).toHaveLength(1);
    expect(eventRows('operational_task_created').length).toBeGreaterThan(0);
    expect(eventRows('readiness_status_changed')).toHaveLength(1);
  });

  it('records meaningful booking updates without sensitive values and ignores no-op updates', async () => {
    const record = await createRecord();
    const { updateBookingOpsRecord } = await import('../repository');
    const secret = 'PASSPORT 45 01 123456 secret@example.com';

    await updateBookingOpsRecord(record.id, {
      documentNotes: secret,
      guestEmail: 'secret@example.com',
    }, { actorType: 'admin' });
    await updateBookingOpsRecord(record.id, { documentNotes: secret }, { actorType: 'admin' });

    expect(eventRows('booking_updated')).toHaveLength(1);
    expect(JSON.stringify(eventRows('booking_updated'))).not.toContain(secret);
    expect(JSON.stringify(eventRows('booking_updated'))).not.toContain('secret@example.com');
  });

  it('records task action, Telegram draft creation/reuse, and does not spam repeats or send', async () => {
    const record = await createRecord();
    const { listBookingOpsTasksForRecord } = await import('../tasks');
    const { runBookingOpsTaskAction } = await import('../task-action-runner');
    const listed = await listBookingOpsTasksForRecord(record.id);
    expect(listed.ok).toBe(true);
    const task = listed.ok
      ? listed.tasks.find((item) => item.taskType === 'request_guest_documents')
      : null;
    expect(task).toBeTruthy();

    await runBookingOpsTaskAction(record, task!);
    await runBookingOpsTaskAction(record, task!);
    await runBookingOpsTaskAction(record, task!);

    expect(eventRows('task_action_run')).toHaveLength(1);
    expect(eventRows('telegram_draft_created')).toHaveLength(1);
    expect(eventRows('telegram_draft_reused')).toHaveLength(1);
    expect(tables.booking_ops_telegram_drafts).toHaveLength(1);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('records task status changes only when status changes', async () => {
    const record = await createRecord();
    const { listBookingOpsTasksForRecord, updateBookingOpsTask } = await import('../tasks');
    const listed = await listBookingOpsTasksForRecord(record.id);
    const task = listed.ok ? listed.tasks[0] : null;
    expect(task).toBeTruthy();

    await updateBookingOpsTask(record.id, task!.id, { status: 'in_progress' });
    await updateBookingOpsTask(record.id, task!.id, { status: 'in_progress' });

    expect(eventRows('task_status_changed')).toHaveLength(1);
  });

  it('records a completion effect without document data or external sends', async () => {
    const record = await createRecord();
    const task: BookingOpsTask = {
      id: 'completion-task',
      bookingOpsRecordId: record.id,
      bookingId: record.bookingId,
      taskType: 'verify_guest_documents',
      title: 'Проверить документы',
      description: null,
      status: 'open',
      priority: 'normal',
      source: 'readiness_gate',
      dueAt: null,
      completedAt: null,
      metadata: {},
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
    const { updateBookingOpsTaskWithCompletionEffects } = await import('../task-completion-effects');

    const result = await updateBookingOpsTaskWithCompletionEffects(record.id, task.id, {
      status: 'completed',
    }, {
      getRecord: vi.fn(async () => record),
      getTask: vi.fn(async () => ({ ok: true as const, task })),
      updateRecord: vi.fn(async () => ({ ok: true, record })),
      updateTask: vi.fn(async () => ({ ok: true as const, task: { ...task, status: 'completed' as const } })),
      syncTasks: vi.fn(async () => ({ ok: true })),
      applyTelegramDraftStatus: vi.fn(async () => ({ ok: true })),
    });

    expect(result.ok).toBe(true);
    expect(eventRows('completion_effect_applied')).toHaveLength(1);
    expect(JSON.stringify(eventRows('completion_effect_applied'))).not.toContain('PASSPORT');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('sanitizes arbitrary metadata keys before persistence', async () => {
    const record = await createRecord();
    const { recordBookingOpsEvent } = await import('../events');
    await recordBookingOpsEvent({
      bookingOpsRecordId: record.id,
      eventType: 'booking_updated',
      title: 'Безопасная проверка',
      actorType: 'admin',
      metadata: {
        changedGroups: ['readiness_inputs'],
        documentNotes: 'PASSPORT 45 01 123456',
        messageText: 'private payload',
      },
      dedupeKey: 'metadata-safety',
    });

    const stored = eventRows('booking_updated').at(-1);
    expect(stored?.metadata).toEqual({ changedGroups: ['readiness_inputs'] });
  });

  it('includes booking_created in timeline even when newer events exceed the default limit', async () => {
    const record = await createRecord();
    const { recordBookingOpsEvent, listBookingOpsEvents } = await import('../events');
    const created = eventRows('booking_created')[0];
    expect(created).toBeTruthy();

    for (let index = 0; index < 55; index += 1) {
      await recordBookingOpsEvent({
        bookingOpsRecordId: record.id,
        eventType: 'task_status_changed',
        title: `Статус задачи ${index}`,
        actorType: 'system',
        metadata: { taskType: 'request_guest_documents', status: 'open' },
        dedupeKey: `timeline-overflow-${index}`,
      });
    }

    const listed = await listBookingOpsEvents(record.id);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;

    expect(listed.events.length).toBeGreaterThan(50);
    expect(listed.events.some((event) => event.eventType === 'booking_created')).toBe(true);
    expect(JSON.stringify(listed.events)).not.toContain('PASSPORT');
    expect(JSON.stringify(listed.events)).not.toContain('secret@example.com');
  });
});
