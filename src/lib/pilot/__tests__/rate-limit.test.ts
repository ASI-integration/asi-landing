import { afterEach, describe, expect, it } from 'vitest';
import {
  assertPilotCreateRateLimit,
  resetPilotCreateRateLimitForTests,
} from '../rate-limit';
import { PilotAccessError } from '../errors';

afterEach(() => {
  resetPilotCreateRateLimitForTests();
});

describe('SP-04 assertPilotCreateRateLimit', () => {
  it('allows up to 10 creates per minute per user', () => {
    const now = 1_000_000;
    for (let i = 0; i < 10; i += 1) {
      expect(() => assertPilotCreateRateLimit('pilot-a', now + i)).not.toThrow();
    }
    expect(() => assertPilotCreateRateLimit('pilot-a', now + 11)).toThrow(PilotAccessError);
    try {
      assertPilotCreateRateLimit('pilot-a', now + 12);
    } catch (error) {
      expect(error).toMatchObject({ code: 'rate_limited', status: 429 });
    }
  });

  it('isolates rate buckets by pilot user', () => {
    const now = 2_000_000;
    for (let i = 0; i < 10; i += 1) {
      assertPilotCreateRateLimit('pilot-a', now);
    }
    expect(() => assertPilotCreateRateLimit('pilot-b', now)).not.toThrow();
  });
});
