import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRuntimeBridgeRunnerInput } from '../bridge-schema';
import {
  parseRuntimeExecutionLaneEvidence,
  resolveRuntimeExecutionLaneEvidence,
  isRuntimeExecutionLaneAuthoritativelyFree,
  RUNTIME_EXECUTION_LANE_REASON_CODES,
} from '../execution-lane';

const NOW = '2026-09-08T12:00:00.000Z';
const FRESH_EXPIRY = '2026-09-08T12:01:00.000Z';
const NOW_MS = Date.parse(NOW);

function freeLane() {
  return {
    schemaVersion: 'asi.runtime.execution-lane.v1' as const,
    state: 'free' as const,
    reasonCode: RUNTIME_EXECUTION_LANE_REASON_CODES.free,
    checkedAt: NOW,
    expiresAt: FRESH_EXPIRY,
  };
}

describe('parseRuntimeExecutionLaneEvidence', () => {
  it('accepts a valid free lane record', () => {
    expect(parseRuntimeExecutionLaneEvidence(freeLane())).toEqual(freeLane());
  });

  it('rejects mismatched state/reasonCode pairs', () => {
    expect(parseRuntimeExecutionLaneEvidence({
      ...freeLane(),
      state: 'free',
      reasonCode: RUNTIME_EXECUTION_LANE_REASON_CODES.action_required,
    })).toBeNull();
  });
});

describe('resolveRuntimeExecutionLaneEvidence', () => {
  it('does not infer a free lane from missing evidence or empty blockers', () => {
    expect(resolveRuntimeExecutionLaneEvidence({
      schemaVersion: 'asi.runtime.runner-readiness.v2',
      checkedAt: NOW,
      expiresAt: FRESH_EXPIRY,
      blockers: [],
    })).toBeNull();
  });

  it('treats Runtime ACTION_REQUIRED control-plane blockers as a blocked lane', () => {
    const resolved = resolveRuntimeExecutionLaneEvidence({
      schemaVersion: 'asi.runtime.runner-readiness.v2',
      checkedAt: NOW,
      expiresAt: FRESH_EXPIRY,
      blockers: ['runtime_control_plane_action_required'],
    });
    expect(resolved).toMatchObject({
      state: 'action_required',
      reasonCode: RUNTIME_EXECUTION_LANE_REASON_CODES.action_required,
    });
    expect(isRuntimeExecutionLaneAuthoritativelyFree(resolved, NOW_MS)).toBe(false);
  });

  it('does not trust a published free field when control-plane blockers say ACTION_REQUIRED', () => {
    const resolved = resolveRuntimeExecutionLaneEvidence({
      schemaVersion: 'asi.runtime.runner-readiness.v2',
      checkedAt: NOW,
      expiresAt: FRESH_EXPIRY,
      blockers: ['runtime_execution_lane_action_required'],
      executionLane: freeLane(),
    });
    expect(resolved?.state).toBe('action_required');
    expect(isRuntimeExecutionLaneAuthoritativelyFree(resolved, NOW_MS)).toBe(false);
  });

  it('returns published free evidence when Runtime actually publishes it', () => {
    const resolved = resolveRuntimeExecutionLaneEvidence({
      schemaVersion: 'asi.runtime.runner-readiness.v2',
      checkedAt: NOW,
      expiresAt: FRESH_EXPIRY,
      blockers: [],
      executionLane: freeLane(),
    });
    expect(isRuntimeExecutionLaneAuthoritativelyFree(resolved, NOW_MS)).toBe(true);
  });

  it('keeps existing v2 readiness parse compatible and accepts optional executionLane', () => {
    const fixture = JSON.parse(
      readFileSync(
        resolve('src/lib/asi-runtime/__fixtures__/runner-readiness-v2-runtime-pr99.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    fixture.checkedAt = new Date().toISOString();
    fixture.expiresAt = new Date(Date.now() + 45_000).toISOString();
    expect(parseRuntimeBridgeRunnerInput({
      operation: 'runner_publish_readiness',
      input: fixture,
    })?.operation).toBe('runner_publish_readiness');
    expect(parseRuntimeBridgeRunnerInput({
      operation: 'runner_publish_readiness',
      input: { ...fixture, executionLane: freeLane() },
    })?.operation).toBe('runner_publish_readiness');
    expect(parseRuntimeBridgeRunnerInput({
      operation: 'runner_publish_readiness',
      input: {
        ...fixture,
        executionLane: { ...freeLane(), extra: true },
      },
    })).toBeNull();
  });
});
