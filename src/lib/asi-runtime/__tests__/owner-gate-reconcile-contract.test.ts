/**
 * Cross-repo contract fixture: Landing #272 <-> Runtime #127 (future change).
 *
 * This documents exactly what asi-os-runtime must persist locally as durable
 * pending-reconciliation evidence to survive a crash between producing an
 * owner_gate and Landing committing it, and proves Landing's parser accepts
 * that exact shape. Landing does not implement the Runtime side here.
 *
 * Expected future Runtime flow (documented, not implemented in this repo):
 *   executor produces owner_gate
 *   -> Runtime persists local pending reconciliation evidence
 *      (runnerId, taskId, attemptCount, originalLeaseToken, exact gate payload)
 *   -> physical slot ACTION_REQUIRED
 *   -> call runner_reconcile_owner_gate
 *   -> on COMMITTED | COMMITTED_DEDUPLICATED | RECOVERED_AND_COMMITTED:
 *        mark local ownership remotely confirmed
 *   -> crash/restart: retry the same reconciliation call verbatim
 *   -> on TERMINAL | SUPERSEDED: safely clear/release the stale local hold
 *   -> on CONFLICT: fail closed and require investigation
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRuntimeBridgeRunnerInput } from '../bridge-schema';

const FIXTURE = resolve(
  process.cwd(),
  'src/lib/asi-runtime/__fixtures__/owner-gate-reconcile-runner-request-v1.json',
);

function loadFixture(): unknown {
  return JSON.parse(readFileSync(FIXTURE, 'utf8'));
}

describe('runner_reconcile_owner_gate contract fixture', () => {
  it('parses the documented Runtime persistence shape', () => {
    const parsed = parseRuntimeBridgeRunnerInput(loadFixture());
    expect(parsed?.operation).toBe('runner_reconcile_owner_gate');
  });

  it('requires runnerId, taskId, attemptCount and an exact gate; originalLeaseToken is optional', () => {
    const fixture = loadFixture() as { input: Record<string, unknown> };
    const withoutOptional = {
      operation: 'runner_reconcile_owner_gate',
      input: {
        runnerId: fixture.input.runnerId,
        taskId: fixture.input.taskId,
        attemptCount: fixture.input.attemptCount,
        gate: fixture.input.gate,
      },
    };
    expect(parseRuntimeBridgeRunnerInput(withoutOptional)?.operation).toBe('runner_reconcile_owner_gate');

    for (const missing of ['runnerId', 'taskId', 'attemptCount', 'gate']) {
      const { [missing]: _omit, ...rest } = fixture.input;
      expect(parseRuntimeBridgeRunnerInput({ operation: 'runner_reconcile_owner_gate', input: rest })).toBeNull();
    }
  });

  it('rejects unknown execution-slot-shaped extras (exact schema, no identity smuggling)', () => {
    const fixture = loadFixture() as { input: Record<string, unknown> };
    expect(parseRuntimeBridgeRunnerInput({
      operation: 'runner_reconcile_owner_gate',
      input: { ...fixture.input, leaseToken: fixture.input.originalLeaseToken },
    })).toBeNull();
    expect(parseRuntimeBridgeRunnerInput({
      operation: 'runner_reconcile_owner_gate',
      input: { ...fixture.input, holderStartTicks: '12345' },
    })).toBeNull();
  });

  it('accepts an already-expired exact gate for reconciliation replay (unlike a fresh runner_submit_owner_gate)', () => {
    const fixture = loadFixture() as { input: { gate: Record<string, unknown> } & Record<string, unknown> };
    const expired = {
      operation: 'runner_reconcile_owner_gate',
      input: { ...fixture.input, gate: { ...fixture.input.gate, expiresAt: '2020-01-01T00:00:00.000Z' } },
    };
    expect(parseRuntimeBridgeRunnerInput(expired)?.operation).toBe('runner_reconcile_owner_gate');

    const freshGateExpired = {
      operation: 'runner_submit_owner_gate',
      input: {
        runnerId: fixture.input.runnerId,
        taskId: fixture.input.taskId,
        leaseToken: fixture.input.originalLeaseToken,
        gate: { ...fixture.input.gate, expiresAt: '2020-01-01T00:00:00.000Z' },
      },
    };
    expect(parseRuntimeBridgeRunnerInput(freshGateExpired)).toBeNull();
  });
});
