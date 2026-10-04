import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireScope: vi.fn(),
}));

const database = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const state = {
    task: {
      id: 'task-1',
      booking_id: 'booking-1',
      object_id: 'property-1',
      assigned_role: 'cleaner',
      assigned_person_id: null,
      status: 'pending',
      task_key: 'booking-1:cleaner',
      deadline: null,
    } as Row,
    link: {
      id: 'link-1',
      task_id: 'task-1',
      revoked_at: null,
    } as Row,
    lastWorkerSelectFilters: {} as Row,
    lastWorkerUpdateFilters: {} as Row,
    workerUpdateCount: 0,
    secureUpdateCount: 0,
    insertedLinks: [] as Row[],
    auditRows: [] as Row[],
  };

  class Query {
    private mode: 'select' | 'update' | 'insert' = 'select';
    private patch: Row = {};
    private filters: Row = {};
    constructor(private table: string) {}
    select() { return this; }
    update(patch: Row) { this.mode = 'update'; this.patch = patch; return this; }
    insert(row: Row) { this.mode = 'insert'; this.patch = row; return this; }
    eq(key: string, value: unknown) { this.filters[key] = value; return this; }
    is(key: string, value: unknown) { this.filters[key] = value; return this; }
    private matches(row: Row) {
      return Object.entries(this.filters).every(([key, value]) => row[key] === value);
    }
    private result() {
      if (this.table === 'booking_ops_worker_tasks') {
        if (this.mode === 'select') {
          state.lastWorkerSelectFilters = { ...this.filters };
          return { data: this.matches(state.task) ? { ...state.task } : null, error: null };
        }
        state.lastWorkerUpdateFilters = { ...this.filters };
        state.workerUpdateCount += 1;
        if (this.matches(state.task)) Object.assign(state.task, this.patch);
        return { data: null, error: null };
      }
      if (this.table === 'booking_ops_secure_task_links') {
        if (this.mode === 'select') {
          const related = {
            booking_id: state.task.booking_id,
            object_id: state.task.object_id,
          };
          return {
            data: this.matches(state.link)
              ? { ...state.link, booking_ops_worker_tasks: related }
              : null,
            error: null,
          };
        }
        if (this.mode === 'update') {
          state.secureUpdateCount += 1;
          if (this.matches(state.link)) Object.assign(state.link, this.patch);
          return { data: null, error: null };
        }
        state.insertedLinks.push({ ...this.patch });
        return { data: null, error: null };
      }
      if (this.table === 'booking_ops_worker_link_audit') {
        if (this.mode === 'insert') state.auditRows.push({ ...this.patch });
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }
    async single() { return this.result(); }
    async maybeSingle() { return this.result(); }
    async order() {
      if (this.table !== 'booking_ops_worker_tasks') return this.result();
      state.lastWorkerSelectFilters = { ...this.filters };
      return { data: this.matches(state.task) ? [{ ...state.task }] : [], error: null };
    }
    then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
      return Promise.resolve(this.result()).then(resolve, reject);
    }
  }

  return {
    state,
    supabase: { from: (table: string) => new Query(table) },
  };
});

vi.mock('@/lib/supabase', () => ({ supabase: database.supabase }));
vi.mock('@/lib/booking-ops/repository', () => ({
  requireBookingOpsRecordScope: mocks.requireScope,
}));

import {
  issueWorkerTaskLink,
  listWorkerTasks,
  revokeWorkerTaskLink,
} from '../secure-worker-links';

const scope = { accountId: 'account-a', propertyId: 'property-1' };

describe('secure worker links canonical scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.state.task = {
      id: 'task-1',
      booking_id: 'booking-1',
      object_id: 'property-1',
      assigned_role: 'cleaner',
      assigned_person_id: null,
      status: 'pending',
      task_key: 'booking-1:cleaner',
      deadline: null,
    };
    database.state.link = { id: 'link-1', task_id: 'task-1', revoked_at: null };
    database.state.lastWorkerSelectFilters = {};
    database.state.lastWorkerUpdateFilters = {};
    database.state.workerUpdateCount = 0;
    database.state.secureUpdateCount = 0;
    database.state.insertedLinks = [];
    database.state.auditRows = [];
    mocks.requireScope.mockResolvedValue({});
  });

  it('lists only worker tasks inside the canonical property scope', async () => {
    const tasks = await listWorkerTasks('booking-1', scope);

    expect(tasks).toHaveLength(1);
    expect(database.state.lastWorkerSelectFilters).toMatchObject({
      booking_id: 'booking-1',
      object_id: 'property-1',
    });
    expect(mocks.requireScope).toHaveBeenCalledTimes(2);
    expect(mocks.requireScope).toHaveBeenCalledWith('booking-1', scope);
  });

  it('constrains link issuance task assignment to booking and property', async () => {
    await issueWorkerTaskLink({
      bookingId: 'booking-1',
      taskId: 'task-1',
      role: 'inspector',
      expiresAt: '2099-01-01T00:00:00.000Z',
      expectedScope: scope,
    });

    expect(database.state.lastWorkerUpdateFilters).toMatchObject({
      id: 'task-1',
      booking_id: 'booking-1',
      object_id: 'property-1',
    });
    expect(database.state.insertedLinks).toHaveLength(1);
    expect(database.state.auditRows).toHaveLength(1);
    expect(mocks.requireScope).toHaveBeenCalledWith('booking-1', scope);
  });

  it('fails closed before link mutations when scope changes before assignment', async () => {
    mocks.requireScope
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('booking_scope_mismatch'));

    await expect(issueWorkerTaskLink({
      bookingId: 'booking-1',
      taskId: 'task-1',
      role: 'inspector',
      expiresAt: '2099-01-01T00:00:00.000Z',
      expectedScope: scope,
    })).rejects.toThrow('booking_scope_mismatch');

    expect(database.state.workerUpdateCount).toBe(0);
    expect(database.state.secureUpdateCount).toBe(0);
    expect(database.state.insertedLinks).toHaveLength(0);
    expect(database.state.auditRows).toHaveLength(0);
  });

  it('rejects revocation when the linked task object drifts outside the property', async () => {
    database.state.task.object_id = 'property-b';

    await expect(revokeWorkerTaskLink({
      bookingId: 'booking-1',
      linkId: 'link-1',
      expectedScope: scope,
    })).rejects.toThrow('worker_task_scope_mismatch');

    expect(database.state.secureUpdateCount).toBe(0);
    expect(database.state.auditRows).toHaveLength(0);
  });

  it('preserves legacy issuance when no expected scope is supplied', async () => {
    await issueWorkerTaskLink({
      bookingId: 'booking-1',
      taskId: 'task-1',
      role: 'cleaner',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    expect(mocks.requireScope).not.toHaveBeenCalled();
    expect(database.state.insertedLinks).toHaveLength(1);
  });
});
