import { describe, expect, it } from 'vitest';
import { computeLeadAutomation, serializeLeadAutomation } from '../automation';

describe('lead automation v1 (rule-based)', () => {
  it('classifies a lead that already has a PMS (RealtyCalendar)', () => {
    const automation = computeLeadAutomation({
      objectCountRange: '2-5',
      objectTypes: ['Квартиры'],
      pms: ['RealtyCalendar'],
      automationProcesses: ['Общение с гостями и автоответы'],
    });

    expect(automation.scenario).toBe('has_pms');
    expect(automation.pmsState).toBe('has_pms');
    expect(automation.suggestedStatus).toBe('needs_pms_access');
    expect(automation.nextStep).toContain('RealtyCalendar');
    expect(automation.onboardingChecklist).toContain('Выбрать тестовый объект');
    expect(automation.manualReplyNeeded).toBe(false);
    expect(automation.manualReplyReason).toBe('none');
  });

  it('uses Bnovo and TravelLine specific next steps', () => {
    expect(computeLeadAutomation({ objectCountRange: '2-5', pms: ['Bnovo'] }).nextStep).toContain('Bnovo');
    expect(computeLeadAutomation({ objectCountRange: '2-5', pms: ['TravelLine'] }).nextStep).toContain('TravelLine');
  });

  it('classifies a fully manual lead without PMS as qualified', () => {
    const automation = computeLeadAutomation({
      objectCountRange: '2-5',
      objectTypes: ['Квартиры'],
      pms: ['Нет, всё ведём вручную'],
    });

    expect(automation.scenario).toBe('no_pms_manual');
    expect(automation.suggestedStatus).toBe('qualified');
    expect(automation.nextStep).toContain('Помочь выбрать PMS/МК');
    expect(automation.onboardingChecklist).toContain('Выбрать PMS/МК или временный ручной режим');
    expect(automation.manualReplyNeeded).toBe(false);
  });

  it('classifies a lead that is only choosing a PMS as qualified', () => {
    const automation = computeLeadAutomation({
      objectCountRange: '2-5',
      pms: ['Только выбираем / подключаем'],
    });

    expect(automation.scenario).toBe('choosing_pms');
    expect(automation.suggestedStatus).toBe('qualified');
    expect(automation.nextStep).toContain('подходящий сценарий подключения');
    expect(automation.onboardingChecklist).toContain('Выбрать PMS/МК или временный ручной режим');
  });

  it('flags a support question as manual reply needed', () => {
    const automation = computeLeadAutomation({
      source: 'support',
      hasSupportRequest: true,
      hasOpenSupportRequest: true,
    });

    expect(automation.scenario).toBe('support_question');
    expect(automation.manualReplyNeeded).toBe(true);
    expect(automation.manualReplyReason).toBe('support_question');
    expect(automation.suggestedStatus).toBe('manual_reply_needed');
    expect(automation.onboardingChecklist).toContain('Прочитать вопрос');
  });

  it('marks high-value operators (20+ objects) as pilot candidates needing manual reply', () => {
    const automation = computeLeadAutomation({
      objectCountRange: '20+',
      objectTypes: ['Квартиры'],
      pms: ['Только выбираем / подключаем'],
    });

    expect(automation.scenario).toBe('high_value_operator');
    expect(automation.manualReplyNeeded).toBe(true);
    expect(automation.manualReplyReason).toBe('high_value_lead');
  });

  it('keeps PMS-driven status for a high-value lead that already has a PMS', () => {
    const automation = computeLeadAutomation({
      objectCountRange: '20+',
      pms: ['Bnovo'],
    });

    expect(automation.scenario).toBe('high_value_operator');
    expect(automation.suggestedStatus).toBe('needs_pms_access');
    expect(automation.nextStep).toContain('Bnovo');
    expect(automation.manualReplyNeeded).toBe(true);
  });

  it('detects commercial and mixed portfolios from object types', () => {
    expect(
      computeLeadAutomation({ objectCountRange: '2-5', objectTypes: ['Коммерческая недвижимость'], pms: ['Bnovo'] }).scenario,
    ).toBe('commercial_property');
    expect(
      computeLeadAutomation({ objectCountRange: '2-5', objectTypes: ['Смешанный портфель'], pms: ['Bnovo'] }).scenario,
    ).toBe('mixed_portfolio');
  });

  it('falls back to unclear with a clarify checklist when there is too little data', () => {
    const automation = computeLeadAutomation({});

    expect(automation.scenario).toBe('unclear');
    expect(automation.suggestedStatus).toBe('new');
    expect(automation.onboardingChecklist).toContain('Уточнить наличие PMS/МК');
  });

  it('flags an unrecognized PMS for manual review', () => {
    const automation = computeLeadAutomation({
      objectCountRange: '2-5',
      pms: ['Другой PMS / менеджер каналов'],
    });

    expect(automation.pmsState).toBe('has_pms');
    expect(automation.manualReplyNeeded).toBe(true);
    expect(automation.manualReplyReason).toBe('unclear_pms');
  });

  it('flags custom free-text answers for manual review', () => {
    const automation = computeLeadAutomation({
      objectCountRange: '2-5',
      pms: ['Нет, всё ведём вручную'],
      otherTexts: { object_types: ['таунхаусы'] },
    });

    expect(automation.manualReplyNeeded).toBe(true);
    expect(automation.manualReplyReason).toBe('custom_other_text');
  });

  it('does not over-escalate a single manual object lead (regression)', () => {
    const automation = computeLeadAutomation({
      objectCountRange: '1',
      pms: ['Нет, всё ведём вручную'],
      objectTypes: ['Квартиры'],
      channels: ['Авито', 'Суточно', 'Островок'],
    });

    expect(automation.scenario).not.toBe('high_value_operator');
    expect(['no_pms_manual', 'small_host']).toContain(automation.scenario);
    expect(automation.manualReplyNeeded).toBe(false);
    expect(automation.manualReplyReason).toBe('none');
    expect(automation.suggestedStatus).toBe('qualified');
    expect(automation.potential).not.toBe('высокий');
  });

  it('still does not escalate a single manual object even when AI marked it high potential', () => {
    const automation = computeLeadAutomation({
      objectCountRange: '1',
      pms: ['Нет, всё ведём вручную'],
      objectTypes: ['Квартиры'],
      channels: ['Авито'],
      leadPotential: 'высокий',
    });

    expect(automation.scenario).toBe('no_pms_manual');
    expect(automation.manualReplyNeeded).toBe(false);
    expect(automation.potential).not.toBe('высокий');
  });

  it('classifies 6-20 objects as a high-value operator with high potential', () => {
    const automation = computeLeadAutomation({
      objectCountRange: '6-20',
      objectTypes: ['Квартиры'],
      pms: ['Нет, всё ведём вручную'],
    });

    expect(automation.scenario).toBe('high_value_operator');
    expect(automation.manualReplyNeeded).toBe(true);
    expect(automation.manualReplyReason).toBe('high_value_lead');
    expect(automation.potential).toBe('высокий');
  });

  it('keeps 2-5 manual objects at medium potential without manual reply', () => {
    const automation = computeLeadAutomation({
      objectCountRange: '2-5',
      objectTypes: ['Квартиры'],
      pms: ['Нет, всё ведём вручную'],
    });

    expect(automation.scenario).toBe('no_pms_manual');
    expect(automation.suggestedStatus).toBe('qualified');
    expect(automation.manualReplyNeeded).toBe(false);
    expect(automation.potential).toBe('средний');
  });

  it('flags a commercial single object for manual review at medium potential', () => {
    const automation = computeLeadAutomation({
      objectCountRange: '1',
      objectTypes: ['Коммерческая недвижимость'],
      pms: ['Нет, всё ведём вручную'],
    });

    expect(automation.scenario).toBe('commercial_property');
    expect(automation.manualReplyNeeded).toBe(true);
    expect(automation.potential).toBe('средний');
  });

  it('serializes automation into snake_case for answers_json storage', () => {
    const automation = computeLeadAutomation({ objectCountRange: '2-5', pms: ['RealtyCalendar'] });
    const serialized = serializeLeadAutomation(automation);

    expect(serialized).toMatchObject({
      version: 'v1',
      lead_scenario: 'has_pms',
      manual_reply_needed: false,
      manual_reply_reason: 'none',
      suggested_status: 'needs_pms_access',
    });
    expect(serialized.recommended_next_step).toContain('RealtyCalendar');
    expect(Array.isArray(serialized.onboarding_checklist)).toBe(true);
  });
});
