import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APPLY_CHANNEL_MANAGER_RECONCILIATION_SAFE_REPAIRS } from '@/lib/booking-ops/channel-manager-reconciliation';

const {
  requireOpsAdminSession,
  requireCrmOperatorSession,
  runChannelManagerReconciliationPreview,
  runChannelManagerReconciliationRecovery,
  getChannelManagerReconciliationStatus,
  listRecentChannelManagerReconciliations,
  getChannelManagerConnectionStatus,
  hashCommittedIncrementalCursor,
  findSecretPath,
} = vi.hoisted(() => ({
  requireOpsAdminSession: vi.fn(),
  requireCrmOperatorSession: vi.fn(),
  runChannelManagerReconciliationPreview: vi.fn(),
  runChannelManagerReconciliationRecovery: vi.fn(),
  getChannelManagerReconciliationStatus: vi.fn(),
  listRecentChannelManagerReconciliations: vi.fn(),
  getChannelManagerConnectionStatus: vi.fn(),
  hashCommittedIncrementalCursor: vi.fn(() => 'cursorhashprefix00'),
  findSecretPath: vi.fn((): string | null => null),
}));

vi.mock('@/lib/crm/api-auth', () => ({
  requireOpsAdminSession,
  requireCrmOperatorSession,
}));

vi.mock('@/lib/booking-ops/channel-manager-access-import', () => ({
  findSecretPath,
  getChannelManagerConnectionStatus,
}));

vi.mock('@/lib/booking-ops/channel-manager-live-core', () => ({
  hashCommittedIncrementalCursor,
}));

vi.mock('@/lib/booking-ops/channel-manager-reconciliation', async () => {
  const actual = await vi.importActual<typeof import('@/lib/booking-ops/channel-manager-reconciliation')>(
    '@/lib/booking-ops/channel-manager-reconciliation',
  );
  return {
    ...actual,
    runChannelManagerReconciliationPreview,
    runChannelManagerReconciliationRecovery,
    getChannelManagerReconciliationStatus,
    listRecentChannelManagerReconciliations,
  };
});

import { GET, POST } from '../route';

const RAW_CHECKPOINT = 'raw-checkpoint-should-never-leak';

const sampleReport = {
  runId: 'recon-1',
  connectionId: 'conn-1',
  mode: 'preview' as const,
  status: 'preview_ready' as const,
  snapshotKind: 'complete' as const,
  snapshotHashPrefix: 'snapprefix000000',
  reportHashPrefix: 'reportprefix0000',
  reportHash: 'report-hash-aaaaaaaaaaaaaaaa',
  committedCursorHashAtPreview: 'cursorhashprefix00',
  cursorChangedSincePreview: false,
  startedAt: '2026-08-07T10:00:00.000Z',
  finishedAt: '2026-08-07T10:00:00.000Z',
  safeSummary: 'Сверка (preview): всего 1',
  safeError: null,
  counts: { total: 1, repairable: 1 },
  items: [{
    id: 'item-1',
    category: 'booking_missing_internal' as const,
    severity: 'warning' as const,
    repairability: 'safe_auto' as const,
    status: 'planned' as const,
    externalIdentityHash: 'abc',
    bookingOpsRecordId: null,
    propertyId: 'prop-a',
    safeBefore: {},
    safeAfter: { status: 'confirmed' },
    deterministicActionKey: 'action-1',
    safeMessage: 'create',
    appliedAt: null,
  }],
  repairableCount: 1,
  blockerCount: 0,
  nextAction: 'confirm',
};

function postBody(body: Record<string, unknown>) {
  return new Request('http://localhost/api/dashboard/channel-manager/reconciliation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('channel-manager reconciliation route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireOpsAdminSession.mockResolvedValue({ session: { email: 'ops@asi.test', userId: 'ops-1' } });
    requireCrmOperatorSession.mockResolvedValue({ session: { email: 'ops@asi.test', userId: 'ops-1' } });
    findSecretPath.mockReturnValue(null);
    runChannelManagerReconciliationPreview.mockResolvedValue(sampleReport);
    runChannelManagerReconciliationRecovery.mockResolvedValue({
      ...sampleReport,
      mode: 'apply',
      status: 'completed',
    });
    getChannelManagerReconciliationStatus.mockResolvedValue(sampleReport);
    listRecentChannelManagerReconciliations.mockResolvedValue([sampleReport]);
    getChannelManagerConnectionStatus.mockResolvedValue({
      id: 'conn-1',
      metadata: { incrementalCursor: { checkpoint: RAW_CHECKPOINT } },
    });
  });

  it('requires auth on POST', async () => {
    requireOpsAdminSession.mockResolvedValueOnce({
      error: new Response(JSON.stringify({ ok: false }), { status: 401 }),
    });
    const response = await POST(postBody({ action: 'preview', connectionId: 'conn-1', snapshot: {} }));
    expect(response.status).toBe(401);
    expect(runChannelManagerReconciliationPreview).not.toHaveBeenCalled();
  });

  it('requires auth on GET', async () => {
    requireCrmOperatorSession.mockResolvedValueOnce({
      error: new Response(JSON.stringify({ ok: false }), { status: 401 }),
    });
    const response = await GET(new Request(
      'http://localhost/api/dashboard/channel-manager/reconciliation?connectionId=conn-1',
    ));
    expect(response.status).toBe(401);
  });

  it('preview action', async () => {
    const snapshot = {
      snapshotKind: 'complete',
      asOf: '2026-08-07T12:00:00.000Z',
      bookings: [],
      calendar: [],
      pricing: [],
    };
    const response = await POST(postBody({
      action: 'preview',
      connectionId: 'conn-1',
      snapshot,
    }));
    expect(response.status).toBe(200);
    expect(runChannelManagerReconciliationPreview).toHaveBeenCalledWith({
      connectionId: 'conn-1',
      snapshot,
    });
    const json = await response.json() as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(json.report).toMatchObject({ runId: 'recon-1', mode: 'preview' });
  });

  it('apply_safe_repairs action', async () => {
    const snapshot = {
      snapshotKind: 'complete',
      asOf: '2026-08-07T12:00:00.000Z',
      bookings: [],
      calendar: [],
      pricing: [],
    };
    const response = await POST(postBody({
      action: 'apply_safe_repairs',
      connectionId: 'conn-1',
      reconciliationRunId: 'recon-1',
      reportHash: sampleReport.reportHash,
      confirmationPhrase: APPLY_CHANNEL_MANAGER_RECONCILIATION_SAFE_REPAIRS,
      snapshot,
    }));
    expect(response.status).toBe(200);
    expect(runChannelManagerReconciliationRecovery).toHaveBeenCalledWith({
      connectionId: 'conn-1',
      reconciliationRunId: 'recon-1',
      reportHash: sampleReport.reportHash,
      confirmationPhrase: APPLY_CHANNEL_MANAGER_RECONCILIATION_SAFE_REPAIRS,
      snapshot,
    });
    const json = await response.json() as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(json.confirmationPhraseRequired).toBe(APPLY_CHANNEL_MANAGER_RECONCILIATION_SAFE_REPAIRS);
  });

  it('get_status action', async () => {
    const response = await POST(postBody({
      action: 'get_status',
      connectionId: 'conn-1',
      runId: 'recon-1',
    }));
    expect(response.status).toBe(200);
    expect(getChannelManagerReconciliationStatus).toHaveBeenCalledWith('conn-1', 'recon-1');
    const json = await response.json() as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(json.report).toMatchObject({ runId: 'recon-1' });
  });

  it('list_recent action', async () => {
    const response = await POST(postBody({
      action: 'list_recent',
      connectionId: 'conn-1',
    }));
    expect(response.status).toBe(200);
    expect(listRecentChannelManagerReconciliations).toHaveBeenCalledWith('conn-1', 10);
    const json = await response.json() as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.recent)).toBe(true);
  });

  it('GET list_recent without runId', async () => {
    const response = await GET(new Request(
      'http://localhost/api/dashboard/channel-manager/reconciliation?connectionId=conn-1',
    ));
    expect(response.status).toBe(200);
    expect(listRecentChannelManagerReconciliations).toHaveBeenCalledWith('conn-1', 10);
  });

  it('GET get_status with runId', async () => {
    const response = await GET(new Request(
      'http://localhost/api/dashboard/channel-manager/reconciliation?connectionId=conn-1&runId=recon-1',
    ));
    expect(response.status).toBe(200);
    expect(getChannelManagerReconciliationStatus).toHaveBeenCalledWith('conn-1', 'recon-1');
  });

  it('rejects body-supplied accountId/propertyId/ownerSetupId', async () => {
    const response = await POST(postBody({
      action: 'preview',
      connectionId: 'conn-1',
      accountId: 'spoofed-account',
      propertyId: 'spoofed-property',
      ownerSetupId: 'spoofed-owner',
      snapshot: { snapshotKind: 'complete', asOf: '2026-08-07T12:00:00.000Z', bookings: [], calendar: [], pricing: [] },
    }));
    expect(response.status).toBe(400);
    expect(runChannelManagerReconciliationPreview).not.toHaveBeenCalled();
    const json = await response.json() as Record<string, unknown>;
    expect(String(json.message)).toMatch(/account\/property|контур/i);
  });

  it('rejects secrets', async () => {
    findSecretPath.mockReturnValueOnce('apiToken');
    const response = await POST(postBody({
      action: 'preview',
      connectionId: 'conn-1',
      apiToken: 'secret-value',
      snapshot: {},
    }));
    expect(response.status).toBe(400);
    expect(runChannelManagerReconciliationPreview).not.toHaveBeenCalled();
    const json = await response.json() as Record<string, unknown>;
    expect(String(json.message)).toMatch(/пароль|токен|секрет/i);
  });

  it('does not leak raw checkpoint in response', async () => {
    runChannelManagerReconciliationPreview.mockResolvedValueOnce({
      ...sampleReport,
      // If route incorrectly spreads connection metadata this would leak.
      metadata: { incrementalCursor: { checkpoint: RAW_CHECKPOINT } },
    } as typeof sampleReport);

    const response = await POST(postBody({
      action: 'preview',
      connectionId: 'conn-1',
      snapshot: {
        snapshotKind: 'complete',
        asOf: '2026-08-07T12:00:00.000Z',
        bookings: [],
        calendar: [],
        pricing: [],
        providerCursor: { stream: 'incremental', checkpoint: RAW_CHECKPOINT },
      },
    }));
    expect(response.status).toBe(200);
    const json = await response.json() as Record<string, unknown>;
    const serialized = JSON.stringify(json);
    expect(serialized).not.toContain(RAW_CHECKPOINT);
    expect(json).not.toHaveProperty('connection');
    expect(json.report).not.toHaveProperty('metadata');
  });
});
