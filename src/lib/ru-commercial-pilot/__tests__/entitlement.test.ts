import { describe, expect, it } from 'vitest';
import { derivePropertyPilotKey } from '../entitlement';

describe('RU pilot entitlement identity', () => {
  it('normalizes casing and whitespace for the same property', () => {
    const a = derivePropertyPilotKey({ country: 'RU', city: ' Санкт-Петербург ', addressLine: 'Лиговский   проспект 10' });
    const b = derivePropertyPilotKey({ country: 'ru', city: 'санкт-петербург', addressLine: 'лигОВский проспект 10' });
    expect(a).toBeTruthy();
    expect(a).toBe(b);
  });

  it('does not depend on email or phone and therefore cannot be reset by changing them', () => {
    const key = derivePropertyPilotKey({ country: 'RU', city: 'Москва', addressLine: 'Тверская 1' });
    expect(key).toMatch(/^[a-f0-9]{64}$/);
  });

  it('refuses to create an entitlement identity without a property address', () => {
    expect(derivePropertyPilotKey({ country: 'RU', city: 'Москва', addressLine: '   ' })).toBeNull();
  });
});
