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

function missingDataEvent(input: {
  intent?: string;
  missingFields: string[];
  createdAt?: string;
}): CrmEventRow {
  return {
    id: `evt-missing-${input.intent ?? 'unknown'}-${input.createdAt ?? '1'}`,
    contact_id: 'contact-1',
    event_type: 'guest_test_missing_data',
    message_text: `Вопрос про ${input.intent ?? 'unknown'}`,
    property_id: 'prop-1',
    metadata: {
      intent: input.intent ?? null,
      missing_fields: input.missingFields,
    },
    acknowledged_at: null,
    created_at: input.createdAt ?? '2026-06-18T10:01:00.000Z',
  };
}

function operatorFollowupEvent(input: {
  intent?: string;
  createdAt?: string;
  acknowledgedAt?: string | null;
}): CrmEventRow {
  return {
    id: `evt-operator-${input.intent ?? 'unknown'}-${input.createdAt ?? '1'}`,
    contact_id: 'contact-1',
    event_type: 'operator_followup_required',
    message_text: 'Нужен оператор',
    property_id: 'prop-1',
    metadata: { intent: input.intent ?? null },
    acknowledged_at: input.acknowledgedAt ?? null,
    created_at: input.createdAt ?? '2026-06-18T10:05:00.000Z',
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
      operatorFollowupEvent({ intent: 'operator' }),
    ];
    const summary = computeGuestTestSummary(events, 'prop-1');
    expect(summary.nextAction).toBe('Ответить гостю');
    expect(deriveGuestTestListStatus(events, summary)).toBe('needs_reaction');
  });

  it('supersedes stale wifi missing_data after answered_from_property_data', () => {
    const events: CrmEventRow[] = [
      startedEvent(),
      questionEvent({
        intent: 'wifi',
        outcome: 'missing_data',
        missingFields: ['object.wifiName'],
        createdAt: '2026-06-18T10:43:00.000Z',
      }),
      missingDataEvent({
        intent: 'wifi',
        missingFields: ['object.wifiName'],
        createdAt: '2026-06-18T10:43:01.000Z',
      }),
      questionEvent({
        intent: 'wifi',
        outcome: 'answered_from_property_data',
        createdAt: '2026-06-18T10:45:00.000Z',
      }),
    ];
    const summary = computeGuestTestSummary(events, 'prop-1');
    expect(summary.wifi.status).toBe('verified');
    expect(summary.wifi.label).toBe('проверен');
    expect(summary.missingFields).not.toContain('object.wifiName');
    expect(summary.missingDataActions).toEqual([]);
    expect(deriveGuestTestListStatus(events, summary)).not.toBe('needs_data');
  });

  it('supersedes stale smoking missing_data after answered_from_global_rule', () => {
    const events: CrmEventRow[] = [
      startedEvent(),
      questionEvent({
        intent: 'smoking',
        outcome: 'missing_data',
        missingFields: ['object.houseRules'],
        createdAt: '2026-06-18T10:44:00.000Z',
      }),
      missingDataEvent({
        intent: 'smoking',
        missingFields: ['object.houseRules'],
        createdAt: '2026-06-18T10:44:01.000Z',
      }),
      questionEvent({
        intent: 'smoking',
        outcome: 'answered_from_global_rule',
        createdAt: '2026-06-18T10:46:00.000Z',
      }),
    ];
    const summary = computeGuestTestSummary(events, 'prop-1');
    expect(summary.smoking.status).toBe('verified_global_rule');
    expect(summary.missingFields).not.toContain('object.houseRules');
    expect(summary.missingDataActions.find((action) => action.setupStep === 'rules')).toBeUndefined();
  });

  it('does not keep needs_data when address wifi smoking are successful', () => {
    const events: CrmEventRow[] = [
      startedEvent(),
      questionEvent({
        intent: 'wifi',
        outcome: 'missing_data',
        missingFields: ['object.wifiName'],
        createdAt: '2026-06-18T10:43:00.000Z',
      }),
      missingDataEvent({
        intent: 'wifi',
        missingFields: ['object.wifiName'],
        createdAt: '2026-06-18T10:43:01.000Z',
      }),
      questionEvent({
        intent: 'smoking',
        outcome: 'missing_data',
        missingFields: ['object.houseRules'],
        createdAt: '2026-06-18T10:44:00.000Z',
      }),
      missingDataEvent({
        intent: 'smoking',
        missingFields: ['object.houseRules'],
        createdAt: '2026-06-18T10:44:01.000Z',
      }),
      questionEvent({
        intent: 'address',
        outcome: 'answered_from_property_data',
        createdAt: '2026-06-18T10:45:00.000Z',
      }),
      questionEvent({
        intent: 'wifi',
        outcome: 'answered_from_property_data',
        createdAt: '2026-06-18T10:45:30.000Z',
      }),
      questionEvent({
        intent: 'smoking',
        outcome: 'answered_from_global_rule',
        createdAt: '2026-06-18T10:46:00.000Z',
      }),
    ];
    const summary = computeGuestTestSummary(events, 'prop-1');
    expect(summary.basicPassed).toBe(true);
    expect(summary.missingDataActions).toEqual([]);
    expect(deriveGuestTestListStatus(events, summary)).toBe('partial_pass');
  });

  it('uses latest intent event even when older success exists', () => {
    const events: CrmEventRow[] = [
      startedEvent(),
      questionEvent({
        intent: 'wifi',
        outcome: 'answered_from_property_data',
        createdAt: '2026-06-18T10:40:00.000Z',
      }),
      questionEvent({
        intent: 'wifi',
        outcome: 'missing_data',
        missingFields: ['object.wifiPassword'],
        createdAt: '2026-06-18T10:50:00.000Z',
      }),
    ];
    const summary = computeGuestTestSummary(events, 'prop-1');
    expect(summary.wifi.status).toBe('no_data');
    expect(summary.missingFields).toContain('object.wifiPassword');
    expect(deriveGuestTestListStatus(events, summary)).toBe('needs_data');
  });

  it('does not treat stale guest_test_missing_data as active missingDataActions', () => {
    const events: CrmEventRow[] = [
      startedEvent(),
      missingDataEvent({
        intent: 'wifi',
        missingFields: ['object.wifiName', 'object.wifiPassword'],
        createdAt: '2026-06-18T10:43:01.000Z',
      }),
      questionEvent({
        intent: 'wifi',
        outcome: 'answered_from_property_data',
        createdAt: '2026-06-18T10:45:00.000Z',
      }),
    ];
    const summary = computeGuestTestSummary(events, 'prop-1');
    expect(summary.missingDataActions).toEqual([]);
  });

  it('does not keep needs_reaction for stale operator follow-up after successful answer', () => {
    const events: CrmEventRow[] = [
      startedEvent(),
      operatorFollowupEvent({
        intent: 'wifi',
        createdAt: '2026-06-18T10:43:00.000Z',
      }),
      questionEvent({
        intent: 'wifi',
        outcome: 'answered_from_property_data',
        createdAt: '2026-06-18T10:45:00.000Z',
      }),
      questionEvent({
        intent: 'address',
        outcome: 'answered_from_property_data',
        createdAt: '2026-06-18T10:45:10.000Z',
      }),
      questionEvent({
        intent: 'smoking',
        outcome: 'answered_from_global_rule',
        createdAt: '2026-06-18T10:45:20.000Z',
      }),
    ];
    const summary = computeGuestTestSummary(events, 'prop-1');
    expect(summary.nextAction).not.toBe('Ответить гостю');
    expect(deriveGuestTestListStatus(events, summary)).toBe('partial_pass');
  });
});
