import { describe, expect, it } from 'vitest';
import {
  containsForbiddenStringContent,
  parseRuntimeSnapshotIngestPayload,
  RUNTIME_SNAPSHOT_MAX_BODY_BYTES,
  RUNTIME_SNAPSHOT_SUPPORTED_PAYLOAD_VERSION,
} from '../ingest-schema';

const validPayload = {
  taskId: 'task-42',
  taskTitle: 'Добавить runtime snapshot',
  status: 'running',
  currentStage: 'verify',
  completedSteps: 2,
  totalSteps: 5,
  progressPercent: 40,
  provider: 'cursor',
  attemptNumber: 1,
  commitSha: 'abc1234',
  pullRequestUrl: 'https://github.com/example/repo/pull/7',
  verificationStatus: 'pending',
  lastEvent: 'tests_passed',
  startedAt: '2026-07-20T09:00:00.000Z',
  payloadVersion: RUNTIME_SNAPSHOT_SUPPORTED_PAYLOAD_VERSION,
};

describe('asi-runtime ingest-schema', () => {
  it('accepts a valid whitelisted payload', () => {
    const parsed = parseRuntimeSnapshotIngestPayload(validPayload);
    expect(parsed).toEqual({
      taskId: 'task-42',
      taskTitle: 'Добавить runtime snapshot',
      status: 'running',
      currentStage: 'verify',
      completedSteps: 2,
      totalSteps: 5,
      progressPercent: 40,
      provider: 'cursor',
      attemptNumber: 1,
      commitSha: 'abc1234',
      pullRequestUrl: 'https://github.com/example/repo/pull/7',
      verificationStatus: 'pending',
      lastEvent: 'tests_passed',
      startedAt: '2026-07-20T09:00:00.000Z',
      payloadVersion: 1,
    });
  });

  it('rejects unknown fields', () => {
    expect(parseRuntimeSnapshotIngestPayload({ ...validPayload, userId: 'other-user' })).toBeNull();
    expect(parseRuntimeSnapshotIngestPayload({ ...validPayload, token: 'secret' })).toBeNull();
    expect(parseRuntimeSnapshotIngestPayload({ ...validPayload, env: { FOO: 'bar' } })).toBeNull();
  });

  it('rejects progressPercent outside 0..100', () => {
    expect(parseRuntimeSnapshotIngestPayload({ ...validPayload, progressPercent: -1 })).toBeNull();
    expect(parseRuntimeSnapshotIngestPayload({ ...validPayload, progressPercent: 101 })).toBeNull();
    expect(parseRuntimeSnapshotIngestPayload({ ...validPayload, progressPercent: 12.5 })).toBeNull();
  });

  it('rejects unsupported payloadVersion', () => {
    expect(parseRuntimeSnapshotIngestPayload({ ...validPayload, payloadVersion: 2 })).toBeNull();
  });

  it('rejects invalid pullRequestUrl protocols', () => {
    expect(parseRuntimeSnapshotIngestPayload({
      ...validPayload,
      pullRequestUrl: 'file:///tmp/pr',
    })).toBeNull();
    expect(parseRuntimeSnapshotIngestPayload({
      ...validPayload,
      pullRequestUrl: 'not-a-url',
    })).toBeNull();
  });

  it('rejects secrets and absolute local paths in string fields', () => {
    expect(parseRuntimeSnapshotIngestPayload({
      ...validPayload,
      lastEvent: 'Bearer sk-live-secret-token',
    })).toBeNull();
    expect(parseRuntimeSnapshotIngestPayload({
      ...validPayload,
      taskTitle: 'C:\\Users\\Admin\\secrets\\token.txt',
    })).toBeNull();
    expect(parseRuntimeSnapshotIngestPayload({
      ...validPayload,
      currentStage: '/home/admin/project/.env',
    })).toBeNull();
    expect(containsForbiddenStringContent('ASI_RUNTIME_INGEST_TOKEN=super-secret')).toBe(true);
  });

  it('rejects negative step counters and attemptNumber below 1', () => {
    expect(parseRuntimeSnapshotIngestPayload({ ...validPayload, completedSteps: -1 })).toBeNull();
    expect(parseRuntimeSnapshotIngestPayload({ ...validPayload, totalSteps: -1 })).toBeNull();
    expect(parseRuntimeSnapshotIngestPayload({ ...validPayload, attemptNumber: 0 })).toBeNull();
  });

  it('documents the max request body size', () => {
    expect(RUNTIME_SNAPSHOT_MAX_BODY_BYTES).toBeGreaterThan(1024);
    expect(RUNTIME_SNAPSHOT_MAX_BODY_BYTES).toBeLessThanOrEqual(32_768);
  });
});
