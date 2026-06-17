import { describe, expect, it } from 'vitest';
import { buildPilotDashboardOnboardingModel } from '@/components/PilotDashboardOnboardingBlock';

const CONTACT_ID = '6c9f99b1-726c-4fcf-d428-bcb23d84df20';

describe('PilotDashboardOnboardingBlock', () => {
  it('shows pilot route steps after cabinet login', () => {
    const model = buildPilotDashboardOnboardingModel({
      crmContactId: CONTACT_ID,
      properties: [],
      context: 'list',
    });

    expect(model).not.toBeNull();
    expect(model?.progress.steps.map((step) => step.label)).toEqual([
      'Заявка отправлена',
      'Вход в кабинет',
      'Создание объекта',
      'Заполнение объекта',
      'Тест гостя в Telegram',
    ]);
    expect(model?.progress.steps[0]?.done).toBe(true);
    expect(model?.progress.steps[1]?.done).toBe(true);
    expect(model?.progress.currentStepId).toBe('object_created');
    expect(model?.nextAction.label).toBe('Создать объект');
    expect(model?.nextAction.href).toBeNull();
  });

  it('links telegram continuation with pilot contact payload', () => {
    const model = buildPilotDashboardOnboardingModel({
      crmContactId: CONTACT_ID,
      properties: [],
    });

    expect(model?.telegramHref).toContain('?start=');
    expect(model?.telegramHref).toContain(encodeURIComponent(`pilot_${CONTACT_ID}`));
    expect(model?.telegramHint).toBeNull();
  });

  it('falls back to generic telegram bot when contact id is missing on property detail', () => {
    const model = buildPilotDashboardOnboardingModel({
      crmContactId: null,
      properties: [{ id: 'prop-1', city: null, address: null }],
      propertyId: 'prop-1',
      context: 'detail',
    });

    expect(model).not.toBeNull();
    expect(model?.telegramHref).toMatch(/^https:\/\/t\.me\/ASI_Global_Bot$/);
    expect(model?.telegramHint).toBe('Напишите /start и выберите роль владельца.');
    expect(model?.nextAction.href).toBe('/dashboard/properties/prop-1/setup');
    expect(model?.nextAction.label).toBe('Заполнить данные объекта');
  });

  it('routes setup action to property setup when object exists', () => {
    const model = buildPilotDashboardOnboardingModel({
      crmContactId: CONTACT_ID,
      properties: [{ id: 'prop-1', city: 'Казань', address: 'ул. Баумана, 1' }],
      propertyId: 'prop-1',
      context: 'detail',
    });

    expect(model?.nextAction.href).toBeNull();
    expect(model?.nextAction.label).toBeNull();
    expect(model?.progress.steps[2]?.done).toBe(true);
    expect(model?.progress.steps[3]?.done).toBe(true);
    expect(model?.progress.currentStepId).toBe('guest_test_telegram');
    expect(model?.nextAction.guestTestCommand).toBe('/guest_test prop-1');
  });

  it('shows guest test command on setup page after basics are filled', () => {
    const model = buildPilotDashboardOnboardingModel({
      crmContactId: CONTACT_ID,
      properties: [{ id: 'prop-1', city: 'Казань', address: 'ул. Баумана, 1' }],
      propertyId: 'prop-1',
      context: 'setup',
    });

    expect(model?.nextAction.label).toBeNull();
    expect(model?.nextAction.guestTestCommand).toBe('/guest_test prop-1');
  });
});
