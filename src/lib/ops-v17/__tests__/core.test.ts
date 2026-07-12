import { describe, expect, it } from 'vitest';
import { acceptAdapterBatch, communicationPolicyDefaults, completeMaintenance, completeReinspection, computeLaunchReadiness, initializeModules, onboardingProgress, reportVerificationIssue, taskLinkScopeAllows } from '../core';
import type { OnboardingData } from '../types';

const complete: OnboardingData = {
  business: { name: 'ASI Pilot' }, owner: { name: 'Анна', phone: '+70000000000' },
  properties: [{ key: 'p1', name: 'Лесная', address: 'Лесная, 1' }], units: [{ key: 'u1', propertyKey: 'p1', name: '1' }],
  operations: { checkInTime: '15:00', checkOutTime: '12:00', cleaningRule: 'После выезда' },
  channelManager: { provider: 'manual_import', snapshotReady: true, status: 'synchronized' }, communications: { guestChannel: 'telegram', workerChannel: 'phone' },
  legalPayments: { legalMode: 'review', depositMode: 'review', mvdMode: 'review' },
  staff: [{ key: 's1', name: 'Ирина', role: 'cleaner', contact: '+7111', propertyKeys: ['p1'] }], verification: [{ key: 'access', propertyKey: 'p1', status: 'passed' }],
};

describe('OPS v17 zero-touch onboarding', () => {
  it('persists progress deterministically after each step', () => { const a = onboardingProgress({ business: { name: 'A' } }); const b = onboardingProgress({ business: { name: 'A' } }); expect(a).toEqual(b); expect(a.percentage).toBe(10); });
  it('initializes available modules automatically', () => { expect(initializeModules('o1', complete).every((m) => m.status === 'initialized')).toBe(true); });
  it('does not duplicate modules after retry', () => { const first = initializeModules('o1', complete); const second = initializeModules('o1', complete, first); expect(second).toEqual(first); expect(new Set(second.map((m) => m.idempotencyKey)).size).toBe(second.length); });
  it('blocks launch when data is missing', () => { const modules = initializeModules('o1', {}); expect(computeLaunchReadiness({}, modules).blockingItems.length).toBeGreaterThan(0); });
  it('creates a maintenance task reference for a verification issue', () => { expect(reportVerificationIssue({ key: 'water', propertyKey: 'p1', status: 'pending' }, 'task1')).toMatchObject({ status: 'issue', maintenanceTaskId: 'task1', reinspectionRequired: true }); });
  it('requires reinspection after maintenance', () => { const item = completeMaintenance(reportVerificationIssue({ key: 'water', propertyKey: 'p1', status: 'pending' }, 't1')); expect(item.status).toBe('pending'); expect(item.reinspectionRequired).toBe(true); expect(completeReinspection(item).status).toBe('passed'); });
  it('scopes staff links to one property and task', () => { const link = { propertyKey: 'p1', taskId: 't1', expiresAt: '2099-01-01' }; expect(taskLinkScopeAllows(link, 'p1', 't1')).toBe(true); expect(taskLinkScopeAllows(link, 'p2', 't1')).toBe(false); expect(taskLinkScopeAllows(link, 'p1', 't2')).toBe(false); });
  it('rejects revoked and expired staff links', () => { expect(taskLinkScopeAllows({ propertyKey: 'p1', taskId: 't1', expiresAt: '2099-01-01', revokedAt: '2026-01-01' }, 'p1', 't1')).toBe(false); expect(taskLinkScopeAllows({ propertyKey: 'p1', taskId: 't1', expiresAt: '2020-01-01' }, 'p1', 't1')).toBe(false); });
  it('applies a channel checkpoint once', () => { const batch = { records: [1], checkpoint: 'c1', idempotencyKey: 'i1' }; expect(acceptAdapterBatch(undefined, batch).applied).toBe(true); expect(acceptAdapterBatch('c1', batch).applied).toBe(false); });
  it('keeps manual snapshot fallback available', () => { const readiness = computeLaunchReadiness(complete, initializeModules('o1', complete)); expect(readiness.channelManagerReady).toBe(true); expect(readiness.connectedIntegrations).toEqual(['manual_import']); });
  it('computes authoritative launch readiness', () => { const readiness = computeLaunchReadiness(complete, initializeModules('o1', complete)); expect(readiness.status).toBe('ready_for_pilot'); expect(readiness.blockingItems).toEqual([]); expect(readiness.propertiesReady).toBe(1); });
  it('uses safe automatic communication defaults', () => { expect(communicationPolicyDefaults.automatic).toContain('booking_acknowledgement'); expect(communicationPolicyDefaults.sendingEnabled).toBe(false); });
  it('keeps sensitive communication under review', () => { expect(communicationPolicyDefaults.reviewRequired).toEqual(expect.arrayContaining(['documents', 'deposit', 'mvd', 'access_codes', 'refunds', 'complaints'])); });
  it('degrades an active pilot when a new blocker appears', () => { const data = { ...complete, verification: [{ key: 'fire', propertyKey: 'p1', status: 'issue' as const, blocking: true }] }; expect(computeLaunchReadiness(data, initializeModules('o1', data), true).status).toBe('degraded'); });
});
