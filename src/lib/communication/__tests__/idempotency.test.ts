import { describe, it, expect, beforeEach } from 'vitest';
import { checkAndMarkKey, isDuplicateKey, _resetForTesting, _storeSize } from '../idempotency';

describe('idempotency', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it('returns false and marks a new inbound key', () => {
    const result = checkAndMarkKey({ scope: 'inbound', key: 'telegram:42:msg:100' });
    expect(result).toBe(false);
    expect(_storeSize()).toBe(1);
  });

  it('returns true for a duplicate inbound key', () => {
    checkAndMarkKey({ scope: 'inbound', key: 'telegram:42:msg:200' });
    const result = checkAndMarkKey({ scope: 'inbound', key: 'telegram:42:msg:200' });
    expect(result).toBe(true);
  });

  it('treats different keys/scopes as independent', () => {
    expect(checkAndMarkKey({ scope: 'inbound', key: 'k1' })).toBe(false);
    expect(checkAndMarkKey({ scope: 'inbound', key: 'k2' })).toBe(false);
    expect(checkAndMarkKey({ scope: 'outbound', key: 'k1' })).toBe(false); // scope isolation
    expect(checkAndMarkKey({ scope: 'inbound', key: 'k1' })).toBe(true);
    expect(checkAndMarkKey({ scope: 'inbound', key: 'k2' })).toBe(true);
    expect(_storeSize()).toBe(3);
  });

  it('isDuplicateKey returns true only after checkAndMarkKey', () => {
    expect(isDuplicateKey('inbound', 'x')).toBe(false);
    checkAndMarkKey({ scope: 'inbound', key: 'x' });
    expect(isDuplicateKey('inbound', 'x')).toBe(true);
  });

  it('does not grow unboundedly for many unique ids', () => {
    for (let i = 0; i < 100; i++) checkAndMarkKey({ scope: 'inbound', key: `k:${i}` });
    expect(_storeSize()).toBe(100);
  });
});
