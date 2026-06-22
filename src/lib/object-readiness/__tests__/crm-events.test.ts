import { beforeEach, describe, expect, it, vi } from 'vitest';

const inserted: Array<Record<string, unknown>> = [];

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        if (table === 'crm_events') inserted.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  },
}));

import { emitObjectReadinessEvents } from '../crm-events';
import { computeObjectReadiness, readinessInputFromOnboardingState } from '../engine';

describe('emitObjectReadinessEvents', () => {
  beforeEach(() => {
    inserted.length = 0;
  });

  it('emits ready_for_cm when status transitions even if percent is unchanged', async () => {
    const readiness = computeObjectReadiness(
      readinessInputFromOnboardingState({
        address: 'СПб',
        object_type: 'Квартира',
        checkin_time: '14:00',
        checkout_time: '11:00',
        channels: ['Суточно'],
        rules: ['Не курить'],
        wifi_name: 'wifi',
        wifi_password: 'pass',
        photos_intent: 'later',
        status: 'ready_for_channel_manager',
      }),
    );

    await emitObjectReadinessEvents({
      contactId: 'crm-1',
      previousPercent: 100,
      previousStatus: 'missing_data',
      readiness,
    });

    expect(inserted.map((row) => row.event_type)).toEqual(['object_readiness_ready_for_cm']);
  });

  it('emits readiness percent update and ready_for_cm on final wizard step', async () => {
    const readiness = computeObjectReadiness(
      readinessInputFromOnboardingState({
        address: 'СПб',
        object_type: 'Квартира',
        checkin_time: '14:00',
        checkout_time: '11:00',
        channels: ['Суточно'],
        rules: ['Не курить'],
        wifi_name: 'wifi',
        wifi_password: 'pass',
        photos_intent: 'later',
        status: 'ready_for_channel_manager',
      }),
    );

    await emitObjectReadinessEvents({
      contactId: 'crm-1',
      previousPercent: 88,
      previousStatus: 'missing_data',
      readiness,
    });

    expect(inserted.map((row) => row.event_type)).toEqual([
      'object_readiness_updated',
      'object_readiness_ready_for_cm',
    ]);
    expect(inserted[0]?.message_text).toBe('Готовность объекта: 100%');
  });
});
