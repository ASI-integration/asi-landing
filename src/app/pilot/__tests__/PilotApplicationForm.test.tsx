import { describe, expect, it } from 'vitest';
import { normalizePropertyCountInput } from '../PilotApplicationForm';

describe('pilot application property count input', () => {
  it('removes leading zeroes without changing normal values', () => {
    expect(normalizePropertyCountInput('1')).toBe('1');
    expect(normalizePropertyCountInput('2')).toBe('2');
    expect(normalizePropertyCountInput('02')).toBe('2');
    expect(normalizePropertyCountInput('10')).toBe('10');
  });
});
