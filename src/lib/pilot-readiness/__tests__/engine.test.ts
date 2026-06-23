import { describe, expect, it } from 'vitest';
import { computePilotReadiness } from '@/lib/pilot-readiness/engine';
import type { PilotObjectSnapshot } from '@/lib/pilot-readiness/types';

function baseSnapshot(overrides: Partial<PilotObjectSnapshot> = {}): PilotObjectSnapshot {
  return {
    propertyId: 'OBJ-1',
    objectLabel: 'Квартира',
    name: 'Квартира',
    address: 'СПб, Невский 1',
    description: 'Уютная квартира',
    rules: 'Тишина после 22:00',
    checkInTime: '15:00',
    checkOutTime: '12:00',
    wifiName: 'ASI-Guest',
    wifiPassword: 'pass',
    wifiSkipped: false,
    accessNotes: null,
    checkinInstructions: null,
    photosDeferred: true,
    photosCount: 0,
    bookingChannels: 'Авито',
    communicationMode: 'enabled',
    contactId: null,
    ownerName: null,
    ...overrides,
  };
}

describe('pilot readiness engine', () => {
  it('marks complete snapshot as ready', () => {
    const result = computePilotReadiness(baseSnapshot());
    expect(result.ready).toBe(true);
    expect(result.missingCheckIds).toEqual([]);
  });

  it('detects missing required fields', () => {
    const result = computePilotReadiness(
      baseSnapshot({
        address: null,
        description: null,
        photosDeferred: false,
        photosCount: 0,
      }),
    );
    expect(result.ready).toBe(false);
    expect(result.missingCheckIds).toContain('address');
    expect(result.missingCheckIds).toContain('description');
    expect(result.missingCheckIds).toContain('photos');
  });

  it('accepts wifi access via instructions', () => {
    const result = computePilotReadiness(
      baseSnapshot({
        wifiName: null,
        wifiPassword: null,
        checkinInstructions: 'Код домофона 1234',
      }),
    );
    expect(result.missingCheckIds).not.toContain('wifi_access');
  });
});
