import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireDevelopmentOwnerSession,
  runChannelManagerLiveCoreAcceptance,
  cleanupLiveCoreAcceptanceHarness,
  cleanupLiveCoreSyntheticRecovery,
  previewLiveCoreSyntheticRecovery,
  probeChannelLiveCoreSchema,
} = vi.hoisted(() => ({
  requireDevelopmentOwnerSession: vi.fn(),
  runChannelManagerLiveCoreAcceptance: vi.fn(),
  cleanupLiveCoreAcceptanceHarness: vi.fn(),
  cleanupLiveCoreSyntheticRecovery: vi.fn(),
  previewLiveCoreSyntheticRecovery: vi.fn(),
  probeChannelLiveCoreSchema: vi.fn(),
}));

vi.mock('@/lib/development/api-auth', () => ({ requireDevelopmentOwnerSession }));
vi.mock('@/lib/booking-ops/channel-manager-live-core-acceptance', () => ({
  runChannelManagerLiveCoreAcceptance,
  cleanupLiveCoreAcceptanceHarness,
  cleanupLiveCoreSyntheticRecovery,
  previewLiveCoreSyntheticRecovery,
  LIVE_CORE_RECOVERY_CONFIRM_PHRASE: 'CLEAN_SYNTHETIC_LIVE_CORE_ACCEPTANCE_V1',
  describeLiveCoreAcceptanceUnavailable: () => 'schema blocker',
}));
vi.mock('@/lib/booking-ops/channel-manager-live-core', () => ({
  probeChannelLiveCoreSchema,
}));

import { GET, POST } from '../route';

function request(body: Record<string, unknown>) {
  return new Request('http://localhost/api/dashboard/channel-manager/live-core-acceptance', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('live-core-acceptance route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireDevelopmentOwnerSession.mockResolvedValue({ session: { email: 'owner@asi-global.ru', userId: 'u1' } });
    probeChannelLiveCoreSchema.mockResolvedValue({ ready: true, blocker: null });
    previewLiveCoreSyntheticRecovery.mockResolvedValue({
      recoveryRequired: false,
      safeToCleanup: false,
      blockerCode: 'already_clean',
      blockerSummary: null,
      mainRecord: null,
      descendantManifest: [],
      countsByTable: {},
      exactIdsByTable: {},
      preservedContour: { ownerSetupId: null, propertySetupId: null, connectionId: null },
      importRunIds: [],
      expectedDeletionTotal: 0,
      evidence: {},
    });
    cleanupLiveCoreSyntheticRecovery.mockResolvedValue({
      status: 'already_clean',
      transactionCommitted: false,
      dryRun: true,
      deletedCountsByTable: {},
      preservedContour: { ownerSetupId: null, propertySetupId: null, connectionId: null },
      preservedImportRuns: [],
      postVerification: {},
      preview: {
        recoveryRequired: false,
        safeToCleanup: false,
        blockerCode: 'already_clean',
        blockerSummary: null,
        mainRecord: null,
        descendantManifest: [],
        countsByTable: {},
        exactIdsByTable: {},
        preservedContour: { ownerSetupId: null, propertySetupId: null, connectionId: null },
        importRunIds: [],
        expectedDeletionTotal: 0,
        evidence: {},
      },
      blockerCode: 'already_clean',
      blockerSummary: null,
      safeError: null,
    });
    runChannelManagerLiveCoreAcceptance.mockResolvedValue({
      passed: true,
      schemaReady: true,
      steps: [],
      blocker: null,
    });
    cleanupLiveCoreAcceptanceHarness.mockResolvedValue({
      ok: true,
      cleanupPassed: true,
      scopeVerified: true,
      cascadeScopeVerified: true,
      foreignChildCount: 0,
      foreignChildTables: [],
      ordinaryIdsVerifiedBefore: [],
      ordinaryIdsVerifiedAfter: [],
      ordinaryDataPreserved: true,
      remainingHarnessRows: 0,
      remainingActiveHolds: 0,
      remainingIntakeEvents: 0,
      deleted: {
        bookingOpsRecords: 1,
        connections: 1,
        propertySetups: 1,
        ownerSetups: 1,
        communicationIntents: 0,
        intakeEvents: 1,
        availabilityHolds: 0,
        overbookingChecks: 0,
        telegramDrafts: 0,
        reservationImportRows: 0,
        reservationReconciliationItems: 0,
        reservationLedgerAudit: 0,
        importedBookings: 1,
      },
      failedStage: null,
      blocker: null,
    });
  });

  it('rejects ordinary users without development-owner access', async () => {
    requireDevelopmentOwnerSession.mockResolvedValue({
      error: Response.json({ ok: false, message: 'Нет доступа к консоли разработки ASI.' }, { status: 403 }),
    });
    const response = await POST(request({ action: 'run' }));
    expect(response.status).toBe(403);
    expect(runChannelManagerLiveCoreAcceptance).not.toHaveBeenCalled();
    expect(cleanupLiveCoreAcceptanceHarness).not.toHaveBeenCalled();
  });

  it('rejects ordinary users on GET status probe', async () => {
    requireDevelopmentOwnerSession.mockResolvedValue({
      error: Response.json({ ok: false, message: 'Нет доступа к консоли разработки ASI.' }, { status: 403 }),
    });
    const response = await GET();
    expect(response.status).toBe(403);
    expect(probeChannelLiveCoreSchema).not.toHaveBeenCalled();
  });

  it('runs acceptance for development owner', async () => {
    const response = await POST(request({ action: 'run' }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.evidence.passed).toBe(true);
    expect(runChannelManagerLiveCoreAcceptance).toHaveBeenCalledOnce();
  });

  it('requires explicit confirmation for cleanup', async () => {
    const response = await POST(request({ action: 'cleanup' }));
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.ok).toBe(false);
    expect(cleanupLiveCoreAcceptanceHarness).not.toHaveBeenCalled();
  });

  it('cleans up harness after explicit confirmation', async () => {
    const response = await POST(request({ action: 'cleanup', confirm: true }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.cleanup.cleanupPassed).toBe(true);
    expect(cleanupLiveCoreAcceptanceHarness).toHaveBeenCalledOnce();
  });

  it('returns recovery preview for development owner', async () => {
    const response = await POST(request({ action: 'preview_recovery' }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.recovery.blockerCode).toBe('already_clean');
    expect(previewLiveCoreSyntheticRecovery).toHaveBeenCalledOnce();
  });

  it('requires confirmation phrase for synthetic recovery commit', async () => {
    const response = await POST(request({ action: 'cleanup_recovery', dryRun: false }));
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.ok).toBe(false);
    expect(cleanupLiveCoreSyntheticRecovery).not.toHaveBeenCalled();
  });

  it('commits synthetic recovery with exact confirmation phrase', async () => {
    cleanupLiveCoreSyntheticRecovery.mockResolvedValue({
      status: 'passed',
      transactionCommitted: true,
      dryRun: false,
      deletedCountsByTable: { booking_ops_records: 1 },
      preservedContour: { ownerSetupId: 'o1', propertySetupId: 'p1', connectionId: 'c1' },
      preservedImportRuns: ['r1'],
      postVerification: { deterministicIdentityGone: true },
      preview: {
        recoveryRequired: false,
        safeToCleanup: false,
        blockerCode: 'already_clean',
        blockerSummary: null,
        mainRecord: null,
        descendantManifest: [],
        countsByTable: {},
        exactIdsByTable: {},
        preservedContour: { ownerSetupId: 'o1', propertySetupId: 'p1', connectionId: 'c1' },
        importRunIds: ['r1'],
        expectedDeletionTotal: 0,
        evidence: {},
      },
      blockerCode: 'none',
      blockerSummary: null,
      safeError: null,
    });
    const response = await POST(request({
      action: 'cleanup_recovery',
      dryRun: false,
      confirmPhrase: 'CLEAN_SYNTHETIC_LIVE_CORE_ACCEPTANCE_V1',
    }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(cleanupLiveCoreSyntheticRecovery).toHaveBeenCalledWith(expect.objectContaining({
      dryRun: false,
      confirmPhrase: 'CLEAN_SYNTHETIC_LIVE_CORE_ACCEPTANCE_V1',
    }));
  });

  it('returns failure when cleanup verification does not pass', async () => {
    cleanupLiveCoreAcceptanceHarness.mockResolvedValue({
      ok: false,
      cleanupPassed: false,
      scopeVerified: false,
      cascadeScopeVerified: false,
      foreignChildCount: 1,
      foreignChildTables: ['booking_property_setup_profiles'],
      ordinaryIdsVerifiedBefore: ['booking_property_setup_profiles:x'],
      ordinaryIdsVerifiedAfter: ['booking_property_setup_profiles:x'],
      ordinaryDataPreserved: true,
      remainingHarnessRows: 2,
      remainingActiveHolds: 0,
      remainingIntakeEvents: 0,
      deleted: {
        bookingOpsRecords: 0,
        connections: 0,
        propertySetups: 0,
        ownerSetups: 0,
        communicationIntents: 0,
        intakeEvents: 0,
        availabilityHolds: 0,
        overbookingChecks: 0,
        telegramDrafts: 0,
        reservationImportRows: 0,
        reservationReconciliationItems: 0,
        reservationLedgerAudit: 0,
        importedBookings: 0,
      },
      failedStage: 'harness_scope_preflight',
      blocker: 'harness_scope_collision: таблица booking_property_setup_profiles',
    });
    const response = await POST(request({ action: 'cleanup', confirm: true }));
    const payload = await response.json();
    expect(response.status).toBe(500);
    expect(payload.ok).toBe(false);
    expect(payload.cleanup.cleanupPassed).toBe(false);
    expect(payload.cleanup.failedStage).toBe('harness_scope_preflight');
  });
});
