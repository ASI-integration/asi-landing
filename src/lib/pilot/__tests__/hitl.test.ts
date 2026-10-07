import { describe, expect, it } from 'vitest';
import { buildPilotHitlView, canContinuePilotOwnerGate } from '../hitl';
import type { RuntimeBridgeOwnerGateView } from '@/lib/asi-runtime/bridge-types';

const NOW = '2026-09-08T12:00:00.000Z';

function pendingGate(overrides: Partial<RuntimeBridgeOwnerGateView> = {}): RuntimeBridgeOwnerGateView {
  return {
    schemaVersion: 'asi.runtime.owner-gate.v1',
    action: 'Продолжить правку документации',
    exactTarget: 'docs/pilot/proof.md',
    identity: 'task-cycle-1',
    reason: 'Нужно подтвердить формулировку в proof-файле.',
    evidence: ['raw diagnostic payload should not leak'],
    allowedSideEffect: 'update the same task only',
    rollback: 'leave files unchanged',
    postActionVerification: ['same taskId'],
    taskCycle: 'cycle-1',
    expiresAt: '2026-09-08T13:00:00.000Z',
    gateId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    taskId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    status: 'pending',
    createdAt: NOW,
    ...overrides,
  };
}

describe('canContinuePilotOwnerGate fail-closed allowlist', () => {
  it('allows a known safe docs/pilot gate to continue', () => {
    const gate = pendingGate();
    expect(canContinuePilotOwnerGate(gate)).toBe(true);
    expect(buildPilotHitlView(gate)?.canContinue).toBe(true);
  });

  it('allows an explicitly classified pilot_docs_green gate with deterministic docs/pilot shape', () => {
    const gate = pendingGate({
      classification: 'pilot_docs_green',
      action: 'pilot_docs_update',
    });
    expect(canContinuePilotOwnerGate(gate)).toBe(true);
  });

  it('blocks explicit merge/deploy even when other fields look like docs/pilot', () => {
    expect(canContinuePilotOwnerGate(pendingGate({
      action: 'merge',
      exactTarget: 'docs/pilot/proof.md',
      allowedSideEffect: 'update the same task only',
    }))).toBe(false);
    expect(canContinuePilotOwnerGate(pendingGate({
      action: 'production_deploy',
      exactTarget: 'docs/pilot/proof.md',
    }))).toBe(false);
    expect(buildPilotHitlView(pendingGate({ action: 'deploy' }))?.canContinue).toBe(false);
  });

  it('blocks a privileged action with euphemistic wording and no denylist keyword', () => {
    const gate = pendingGate({
      action: 'promote the current snapshot to the live environment',
      exactTarget: 'live environment',
      allowedSideEffect: 'apply the current snapshot',
      reason: 'Owner confirmation for the current snapshot',
    });
    expect(canContinuePilotOwnerGate(gate)).toBe(false);
    expect(buildPilotHitlView(gate)?.canContinue).toBe(false);
  });

  it('blocks unknown and unclassified gates', () => {
    expect(canContinuePilotOwnerGate(pendingGate({
      action: 'needs confirmation',
      exactTarget: 'unknown-target',
      allowedSideEffect: 'continue the current cycle',
    }))).toBe(false);
    expect(canContinuePilotOwnerGate(pendingGate({
      classification: 'unclassified',
    }))).toBe(false);
    expect(buildPilotHitlView(pendingGate({
      classification: 'unclassified',
    }))?.canContinue).toBe(false);
  });
});
