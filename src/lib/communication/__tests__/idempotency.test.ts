import { describe, it, expect, beforeEach } from 'vitest';
import { checkAndMark, isDuplicate, _resetForTesting, _storeSize } from '../idempotency';

describe('idempotency', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it('returns false and marks a new update_id', () => {
    const result = checkAndMark(100);
    expect(result).toBe(false);
    expect(_storeSize()).toBe(1);
  });

  it('returns true for a duplicate update_id', () => {
    checkAndMark(200);
    const result = checkAndMark(200);
    expect(result).toBe(true);
  });

  it('treats different update_ids as independent', () => {
    expect(checkAndMark(1)).toBe(false);
    expect(checkAndMark(2)).toBe(false);
    expect(checkAndMark(1)).toBe(true);
    expect(checkAndMark(2)).toBe(true);
    expect(_storeSize()).toBe(2);
  });

  it('isDuplicate returns true only after checkAndMark', () => {
    expect(isDuplicate(999)).toBe(false);
    checkAndMark(999);
    expect(isDuplicate(999)).toBe(true);
  });

  it('does not grow unboundedly for many unique ids', () => {
    for (let i = 0; i < 100; i++) checkAndMark(i);
    expect(_storeSize()).toBe(100);
  });
});
