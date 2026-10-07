import { describe, expect, it } from 'vitest';
import { parseMissionControlStatusPayload } from '../schema';

function validPayload() {
  return {
    projectId: 'kim',
    status: 'running',
    stage: 'ТРАНСКРИПЦИЯ',
    progressPercent: 42.4,
    stageProgressPercent: 18.2,
    completedItems: 7,
    totalItems: 21,
    currentItem: 'Beyond the Matrix Episode 7',
    speed: '1.4x',
    eta: '00:42:11',
    lastEvent: 'Whisper обрабатывает текущий файл.',
    updatedAt: '2026-10-07T10:00:00+03:00',
  };
}

describe('mission control status schema', () => {
  it('accepts a bounded safe project status', () => {
    expect(parseMissionControlStatusPayload(validPayload())).toEqual({
      ...validPayload(),
      progressPercent: 42.4,
      stageProgressPercent: 18.2,
      updatedAt: '2026-10-07T07:00:00.000Z',
    });
  });

  it('accepts a missing per-stage progress value', () => {
    const parsed = parseMissionControlStatusPayload({
      ...validPayload(),
      stageProgressPercent: null,
    });
    expect(parsed?.stageProgressPercent).toBeNull();
  });

  it('rejects unknown project ids and extra keys', () => {
    expect(parseMissionControlStatusPayload({
      ...validPayload(),
      projectId: 'other',
    })).toBeNull();

    expect(parseMissionControlStatusPayload({
      ...validPayload(),
      unexpected: 'value',
    })).toBeNull();
  });

  it('rejects invalid progress values instead of silently treating them as missing', () => {
    expect(parseMissionControlStatusPayload({
      ...validPayload(),
      stageProgressPercent: 120,
    })).toBeNull();

    expect(parseMissionControlStatusPayload({
      ...validPayload(),
      stageProgressPercent: '42',
    })).toBeNull();
  });

  it('rejects status strings that may expose paths or secrets', () => {
    expect(parseMissionControlStatusPayload({
      ...validPayload(),
      currentItem: String.raw`C:\Users\Admin\secret.txt`,
    })).toBeNull();

    expect(parseMissionControlStatusPayload({
      ...validPayload(),
      lastEvent: 'Bearer abcdefghijklmnopqrstuvwxyz0123456789',
    })).toBeNull();
  });

  it('rejects impossible counters and malformed timestamps', () => {
    expect(parseMissionControlStatusPayload({
      ...validPayload(),
      completedItems: 22,
      totalItems: 21,
    })).toBeNull();

    expect(parseMissionControlStatusPayload({
      ...validPayload(),
      updatedAt: 'not-a-date',
    })).toBeNull();
  });
});
