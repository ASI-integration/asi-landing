import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeGuestLegalReadiness,
  markDepositWaivedManual,
  markMvdNotRequired,
  shouldBlockLegalCommunication,
  syncGuestLegalReadinessToBookingOpsRecord,
  type GuestLegalReadiness,
} from '../guest-legal-deposit-mvd-execution';

const getBookingOpsRecord = vi.fn();
const updateBookingOpsRecord = vi.fn();

vi.mock('../repository', () => ({
  getBookingOpsRecord: (...args: unknown[]) => getBookingOpsRecord(...args),
  updateBookingOpsRecord: (...args: unknown[]) => updateBookingOpsRecord(...args),
}));

function complete(overrides: Partial<GuestLegalReadiness> = {}): GuestLegalReadiness {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    bookingId: '00000000-0000-4000-8000-000000000002',
    propertySetupId: null,
    propertyId: 'prop_A',
    status: 'ready_for_checkin',
    documentsStatus: 'verified',
    contractStatus: 'signed_manual',
    depositStatus: 'paid_manual',
    mvdStatus: 'submitted_manual',
    availabilityStatus: 'no_conflict',
    blockers: [],
    warnings: [],
    safeSummary: 'Готово.',
    nextAction: null,
    lastCheckedAt: '2026-07-02T00:00:00.000Z',
    metadata: {},
    createdAt: '2026-07-02T00:00:00.000Z',
    updatedAt: '2026-07-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('Guest Legal, Deposit & MVD Execution Pack v1', () => {
  beforeEach(() => {
    getBookingOpsRecord.mockReset();
    updateBookingOpsRecord.mockReset();
  });

  it('missing documents block readiness', () => {
    const result = computeGuestLegalReadiness({
      documentsStatus: 'requested', contractStatus: 'signed_manual', depositStatus: 'paid_manual',
      mvdStatus: 'submitted_manual', availabilityStatus: 'no_conflict',
    });
    expect(result.status).toBe('incomplete');
    expect(result.blockers.some((item) => item.key === 'documents')).toBe(true);
  });

  it('verified documents advance readiness', () => {
    const result = computeGuestLegalReadiness({
      documentsStatus: 'verified', contractStatus: 'signed_manual', depositStatus: 'paid_manual',
      mvdStatus: 'submitted_manual', availabilityStatus: 'no_conflict',
    });
    expect(result.status).toBe('ready_for_checkin');
  });

  it('contract draft does not count as signed', () => {
    expect(computeGuestLegalReadiness({
      documentsStatus: 'verified', contractStatus: 'draft_ready', depositStatus: 'paid_manual',
      mvdStatus: 'submitted_manual', availabilityStatus: 'no_conflict',
    }).blockers.some((item) => item.key === 'contract')).toBe(true);
  });

  it('deposit request draft does not count as paid', () => {
    expect(computeGuestLegalReadiness({
      documentsStatus: 'verified', contractStatus: 'signed_manual', depositStatus: 'request_draft_ready',
      mvdStatus: 'submitted_manual', availabilityStatus: 'no_conflict',
    }).blockers.some((item) => item.key === 'deposit')).toBe(true);
  });

  it('MVD draft does not count as submitted', () => {
    expect(computeGuestLegalReadiness({
      documentsStatus: 'verified', contractStatus: 'signed_manual', depositStatus: 'paid_manual',
      mvdStatus: 'draft_ready', availabilityStatus: 'no_conflict',
    }).blockers.some((item) => item.key === 'mvd')).toBe(true);
  });

  it('manual paid, signed, and submitted statuses permit readiness', () => {
    expect(computeGuestLegalReadiness({
      documentsStatus: 'verified', contractStatus: 'signed_manual', depositStatus: 'paid_manual',
      mvdStatus: 'accepted_manual', availabilityStatus: 'no_conflict',
    }).status).toBe('ready_for_checkin');
  });

  it('explicit MVD not_required permits readiness', () => {
    expect(computeGuestLegalReadiness({
      documentsStatus: 'verified', contractStatus: 'signed_manual', depositStatus: 'waived_manual',
      mvdStatus: 'not_required', availabilityStatus: 'no_conflict',
    }).status).toBe('ready_for_checkin');
  });

  it('availability conflict and missing data block check-in readiness', () => {
    for (const availabilityStatus of ['confirmed_conflict', 'missing_data']) {
      const result = computeGuestLegalReadiness({
        documentsStatus: 'verified', contractStatus: 'signed_manual', depositStatus: 'paid_manual',
        mvdStatus: 'submitted_manual', availabilityStatus,
      });
      expect(result.blockers.some((item) => item.key === 'availability')).toBe(true);
      expect(result.status).not.toBe('ready_for_checkin');
    }
  });

  it('safe request messages remain allowed while blocked', () => {
    const readiness = complete({ status: 'incomplete', documentsStatus: 'requested', blockers: [{ key: 'documents', reason: 'Нужны документы.' }] });
    expect(shouldBlockLegalCommunication({ purpose: 'request_guest_documents' }, readiness).block).toBe(false);
  });

  it('confirmation, check-in, and access messages are blocked while incomplete', () => {
    const readiness = complete({ status: 'incomplete', blockers: [{ key: 'contract', reason: 'Нет подписи.' }] });
    expect(shouldBlockLegalCommunication({ purpose: 'checkin_instructions' }, readiness).block).toBe(true);
    expect(shouldBlockLegalCommunication({ purpose: 'neutral_status_update', messageText: 'Код доступа и получение ключей готовы.' }, readiness).block).toBe(true);
  });

  it('deposit waiver requires a reason before any database action', async () => {
    await expect(markDepositWaivedManual(complete().bookingId, '')).rejects.toThrow('нужна причина');
  });

  it('MVD not_required requires a reason before any database action', async () => {
    await expect(markMvdNotRequired(complete().bookingId, '')).rejects.toThrow('Укажите причину');
  });

  it('bridges legal v1 readiness into booking ops summary fields', async () => {
    getBookingOpsRecord.mockResolvedValue({
      id: complete().bookingId,
      documentsStatus: 'requested',
      contractStatus: 'prepared',
      depositStatus: 'requested',
      mvdStatus: 'prepared',
    });
    updateBookingOpsRecord.mockResolvedValue({ ok: true });

    const result = await syncGuestLegalReadinessToBookingOpsRecord(complete());

    expect(result).toEqual({ ok: true, changed: true });
    expect(updateBookingOpsRecord).toHaveBeenCalledWith(complete().bookingId, {
      documentsStatus: 'verified',
      contractStatus: 'signed',
      depositStatus: 'confirmed',
      mvdStatus: 'submitted',
    }, { actorType: 'system' });
  });

  it('keeps legal v1 summary sync idempotent', async () => {
    getBookingOpsRecord.mockResolvedValue({
      id: complete().bookingId,
      documentsStatus: 'verified',
      contractStatus: 'signed',
      depositStatus: 'confirmed',
      mvdStatus: 'submitted',
    });

    const result = await syncGuestLegalReadinessToBookingOpsRecord(complete());

    expect(result).toEqual({ ok: true, changed: false });
    expect(updateBookingOpsRecord).not.toHaveBeenCalled();
  });
});
