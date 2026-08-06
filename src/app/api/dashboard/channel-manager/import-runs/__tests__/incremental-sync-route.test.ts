import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireOpsAdminSession,
  requireCrmOperatorSession,
  runChannelManagerIncrementalSync,
  getChannelLiveCoreStatus,
  hashCursorCheckpoint,
  toSafeIncrementalRunSummary,
} = vi.hoisted(() => ({
  requireOpsAdminSession: vi.fn(),
  requireCrmOperatorSession: vi.fn(),
  runChannelManagerIncrementalSync: vi.fn(),
  getChannelLiveCoreStatus: vi.fn(),
  hashCursorCheckpoint: vi.fn(() => 'deadbeefcafebabe'),
  toSafeIncrementalRunSummary: vi.fn((run: Record<string, unknown>) => ({
    id: run.id,
    status: run.status,
    importType: run.importType,
    stage: 'completed',
    startedAt: run.startedAt ?? null,
    finishedAt: run.finishedAt ?? null,
    counters: { created: 0, updated: 0, cancelled: 0, restored: 0, skipped: 0, failed: 0, imported: 0, objects: 0, calendarDays: 0, prices: 0 },
    safeError: null,
  })),
}));

vi.mock('@/lib/crm/api-auth', () => ({
  requireOpsAdminSession,
  requireCrmOperatorSession,
}));

vi.mock('@/lib/booking-ops/channel-manager-access-import', () => ({
  findSecretPath: () => null,
  listChannelImportRuns: vi.fn(async () => []),
  registerManualChannelSnapshot: vi.fn(),
  startChannelImportRun: vi.fn(),
  completeChannelImportRun: vi.fn(),
  failChannelImportRun: vi.fn(),
}));

vi.mock('@/lib/booking-ops/channel-manager-live-core', () => ({
  runChannelManagerIncrementalSync,
  runChannelManagerInitialSync: vi.fn(),
  getChannelLiveCoreStatus,
  hashCursorCheckpoint,
  toSafeIncrementalRunSummary,
}));

import { GET, POST } from '../route';

const RAW_CHECKPOINT = 'raw-checkpoint-should-never-leak';

function postIncremental(body: Record<string, unknown>) {
  return new Request('http://localhost/api/dashboard/channel-manager/import-runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('import-runs incremental sync route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireOpsAdminSession.mockResolvedValue({ session: { email: 'ops@asi.test', userId: 'ops-1' } });
    requireCrmOperatorSession.mockResolvedValue({ session: { email: 'ops@asi.test', userId: 'ops-1' } });
    getChannelLiveCoreStatus.mockResolvedValue({
      connectionId: 'conn-1',
      cursorPresent: true,
      cursorCheckpointHash: 'hash:safe',
      incrementalSyncEnabled: true,
    });
    runChannelManagerIncrementalSync.mockResolvedValue({
      run: {
        id: 'run-1',
        status: 'completed',
        importType: 'incremental_sync',
        startedAt: '2026-08-06T10:00:00.000Z',
        finishedAt: '2026-08-06T10:01:00.000Z',
        metadata: {
          liveCoreStage: 'completed',
          // Intentionally unsafe if leaked — route must not return this.
          incrementalCursor: { checkpoint: RAW_CHECKPOINT },
        },
      },
      connection: { id: 'conn-1', metadata: { incrementalCursor: { checkpoint: RAW_CHECKPOINT } } },
      stage: 'completed',
      status: 'completed',
      counters: {
        created: 0, updated: 0, cancelled: 0, restored: 0, skipped: 1, failed: 0,
        imported: 0, objects: 0, calendarDays: 0, prices: 0,
      },
      warnings: [],
      safeError: null,
      cursors: [],
      retryable: true,
      cursorCommitted: true,
      committedCursor: {
        stream: 'incremental',
        checkpoint: RAW_CHECKPOINT,
        batchHash: 'batch-hash',
        updatedAt: '2026-08-06T10:01:00.000Z',
        sourceRunId: 'run-1',
      },
      replayed: false,
    });
  });

  it('ignores spoofed owner/account scope fields and returns a safe run summary only', async () => {
    const response = await POST(postIncremental({
      action: 'run_incremental_sync',
      connectionId: 'conn-1',
      ownerSetupId: 'spoofed-owner-setup',
      ownerId: 'spoofed-owner',
      accountId: 'spoofed-account',
      delta: {
        bookings: [],
        calendar: [],
        pricing: [],
        currentCursor: null,
        nextCursor: { stream: 'incremental', checkpoint: RAW_CHECKPOINT },
        hasMore: false,
      },
    }));

    expect(response.status).toBe(200);
    expect(runChannelManagerIncrementalSync).toHaveBeenCalledTimes(1);
    const call = runChannelManagerIncrementalSync.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call).toMatchObject({
      connectionId: 'conn-1',
    });
    expect(call).not.toHaveProperty('ownerSetupId');
    expect(call).not.toHaveProperty('ownerId');
    expect(call).not.toHaveProperty('accountId');
    expect(call.delta).toMatchObject({
      nextCursor: { checkpoint: RAW_CHECKPOINT },
    });

    const json = await response.json() as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(json.run).toMatchObject({
      id: 'run-1',
      status: 'completed',
      importType: 'incremental_sync',
    });
    expect(json.run).not.toHaveProperty('metadata');
    expect(json).not.toHaveProperty('connection');
    expect(json.cursorCommitted).toBe(true);
    expect(json.cursorPresent).toBe(true);
    expect(json.cursorCheckpointHash).toBe('deadbeefcafebabe');
    expect(json.cursorCheckpointHash).not.toBe(RAW_CHECKPOINT);
    expect(hashCursorCheckpoint).toHaveBeenCalledWith(RAW_CHECKPOINT);

    const serialized = JSON.stringify(json);
    expect(serialized).not.toContain(RAW_CHECKPOINT);
    expect(serialized).not.toContain('spoofed-owner');
    expect(serialized).not.toContain('spoofed-account');
    expect(toSafeIncrementalRunSummary).toHaveBeenCalled();
  });

  it('GET can include liveCore status without raw checkpoint fields', async () => {
    const response = await GET(new Request(
      'http://localhost/api/dashboard/channel-manager/import-runs?connectionId=conn-1',
    ));
    expect(response.status).toBe(200);
    expect(getChannelLiveCoreStatus).toHaveBeenCalledWith('conn-1');
    const json = await response.json() as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(json.liveCore).toMatchObject({
      connectionId: 'conn-1',
      cursorPresent: true,
      cursorCheckpointHash: 'hash:safe',
    });
    expect(JSON.stringify(json)).not.toContain(RAW_CHECKPOINT);
  });
});
