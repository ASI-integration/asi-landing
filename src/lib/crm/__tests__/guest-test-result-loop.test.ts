import { describe, expect, it } from 'vitest';
import {
  computeGuestTestSummary,
  deriveGuestTestListStatus,
  normalizeGuestTestIntent,
} from '../guest-test-result-loop';
import type { CrmEventRow } from '../types';

function questionEvent(input: {
  intent: string;
  outcome: string;
  missingFields?: string[];
  createdAt?: string;
}): CrmEventRow {
  return {
    id: `evt-${input.intent}-${input.outcome}`,
    contact_id: 'contact-1',
    event_type: 'guest_test_question',
    message_text: `Вопрос про ${input.intent}`,
    property_id: 'prop-1',
    metadata: {
      intent: input.intent,
      outcome: input.outcome,
      missing_fields: input.missingFields ?? [],
    },
    acknowledged_at: null,
    created_at: input.createdAt ?? '2026-06-18T10:00:00.000Z',
  };
}

function startedEvent(): CrmEventRow {
  return {
    id: 'evt-started',
    contact_id: 'contact-1',
    event_type: 'guest_test_started',
    message_text: null,
    property_id: 'prop-1',
    metadata: {},
    acknowledged_at: null,
    created_at: '2026-06-18T09:00:00.000Z',
  };
}

describe('guest test result loop', () => {
  it('normalizes house_rules intent to rules', () => {
    expect(normalizeGuestTestIntent('house_rules')).toBe('rules');
    expect(normalizeGuestTestIntent('address')).toBe('address');
  });

  it('marks address as verified from property data', () => {
    const summary = computeGuestTestSummary(
      [startedEvent(), questionEvent({ intent: 'address', outcome: 'answered_from_property_data' })],
      'prop-1',
    );
    expect(summary.address.status).toBe('verified');
    expect(summary.address.label).toBe('проверен');
  });

  it('marks wifi as verified from property data', () => {
    const summary = computeGuestTestSummary(
      [questionEvent({ intent: 'wifi', outcome: 'answered_from_property_data' })],
      'prop-1',
    );
    expect(summary.wifi.status).toBe('verified');
  });

  it('marks smoking as verified global rule', () => {
    const summary = computeGuestTestSummary(
      [questionEvent({ intent: 'smoking', outcome: 'answered_from_global_rule' })],
      'prop-1',
    );
    expect(summary.smoking.status).toBe('verified_global_rule');
    expect(summary.smoking.label).toBe('проверено глобальным правилом');
  });

  it('marks missing wifi as no_data and needs_data list status', () => {
    const events: CrmEventRow[] = [
      startedEvent(),
      questionEvent({ intent: 'wifi', outcome: 'missing_data', missingFields: ['object.wifiName'] }),
      {
        id: 'evt-missing',
        contact_id: 'contact-1',
        event_type: 'guest_test_missing_data',
        message_text: 'Какой Wi-Fi?',
        property_id: 'prop-1',
        metadata: { missing_fields: ['object.wifiName'] },
        acknowledged_at: null,
        created_at: '2026-06-18T10:01:00.000Z',
      },
    ];
    const summary = computeGuestTestSummary(events, 'prop-1');
    expect(summary.wifi.status).toBe('no_data');
    expect(summary.missingFields).toContain('object.wifiName');
    expect(deriveGuestTestListStatus(events, summary)).toBe('needs_data');
  });

  it('detects basic pass and suggests checkin/rules next step', () => {
    const events = [
      startedEvent(),
      questionEvent({ intent: 'address', outcome: 'answered_from_property_data' }),
      questionEvent({ intent: 'wifi', outcome: 'answered_from_property_data', createdAt: '2026-06-18T10:01:00.000Z' }),
      questionEvent({ intent: 'smoking', outcome: 'answered_from_global_rule', createdAt: '2026-06-18T10:02:00.000Z' }),
    ];
    const summary = computeGuestTestSummary(events, 'prop-1');
    expect(summary.basicPassed).toBe(true);
    expect(summary.fullyPassed).toBe(false);
    expect(summary.nextAction).toBe('Проверить заезд и правила');
    expect(deriveGuestTestListStatus(events, summary)).toBe('partial_pass');
  });

  it('detects full pass and pilot next step', () => {
    const events = [
      startedEvent(),
      questionEvent({ intent: 'address', outcome: 'answered_from_property_data' }),
      questionEvent({ intent: 'wifi', outcome: 'answered_from_property_data', createdAt: '2026-06-18T10:01:00.000Z' }),
      questionEvent({ intent: 'smoking', outcome: 'answered_from_global_rule', createdAt: '2026-06-18T10:02:00.000Z' }),
      questionEvent({ intent: 'checkin', outcome: 'answered_from_property_data', createdAt: '2026-06-18T10:03:00.000Z' }),
      questionEvent({ intent: 'rules', outcome: 'answered_from_property_data', createdAt: '2026-06-18T10:04:00.000Z' }),
    ];
    const summary = computeGuestTestSummary(events, 'prop-1');
    expect(summary.fullyPassed).toBe(true);
    expect(summary.nextAction).toBe('Готовить объект к пилоту');
    expect(deriveGuestTestListStatus(events, summary)).toBe('passed');
  });

  it('prioritizes needs_reaction when operator follow-up is open', () => {
    const events: CrmEventRow[] = [
      startedEvent(),
      questionEvent({ intent: 'address', outcome: 'answered_from_property_data' }),
      {
        id: 'evt-operator',
        contact_id: 'contact-1',
        event_type: 'operator_followup_required',
        message_text: 'Хочу вернуть деньги',
        property_id: 'prop-1',
        metadata: {},
        acknowledged_at: null,
        created_at: '2026-06-18T10:05:00.000Z',
      },
    ];
    const summary = computeGuestTestSummary(events, 'prop-1');
    expect(summary.nextAction).toBe('Ответить гостю');
    expect(deriveGuestTestListStatus(events, summary)).toBe('needs_reaction');
  });
});
