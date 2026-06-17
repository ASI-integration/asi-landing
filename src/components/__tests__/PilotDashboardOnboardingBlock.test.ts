import { describe, expect, it } from 'vitest';
import { buildPilotDashboardOnboardingModel } from '@/components/PilotDashboardOnboardingBlock';

const CONTACT_ID = '6c9f99b1-726c-4fcf-d428-bcb23d84df20';

describe('PilotDashboardOnboardingBlock', () => {
  it('shows pilot route steps after cabinet login', () => {
    const model = buildPilotDashboardOnboardingModel({
      crmContactId: CONTACT_ID,
      properties: [],
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
    expect(model?.createObjectHref).toBeNull();
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

  it('routes create-object action to property setup when object exists', () => {
    const model = buildPilotDashboardOnboardingModel({
      crmContactId: CONTACT_ID,
      properties: [{ id: 'prop-1', city: 'Казань', address: 'ул. Баумана, 1' }],
    });

    expect(model?.createObjectHref).toBe('/dashboard/properties/prop-1/setup');
    expect(model?.progress.steps[2]?.done).toBe(true);
    expect(model?.progress.steps[3]?.done).toBe(true);
    expect(model?.progress.currentStepId).toBe('guest_test_telegram');
  });
});
