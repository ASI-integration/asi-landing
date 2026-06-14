import { describe, expect, it } from 'vitest';
import {
  buildChannelManagerOnboarding,
  ensureChannelManagerOnboarding,
  formatChannelManagerOnboardingStatus,
  updateChannelManagerOnboarding,
} from '../channel-manager-onboarding';

describe('channel manager onboarding v1', () => {
  it('creates RealtyCalendar onboarding with checklist and safe client instruction', () => {
    const answers = ensureChannelManagerOnboarding({
      answers: { automation: { lead_scenario: 'has_pms' }, pms: ['RealtyCalendar'] },
      leadStatus: 'needs_pms_access',
      now: '2026-06-14T10:00:00.000Z',
    });

    expect(answers?.channel_manager_onboarding).toMatchObject({
      version: 'v1',
      manager: 'RealtyCalendar',
      status: 'needs_access',
      manual_call_needed: false,
    });
    const onboarding = answers?.channel_manager_onboarding as ReturnType<typeof buildChannelManagerOnboarding>;
    expect(onboarding.checklist).toContain('Выбрать один тестовый объект.');
    expect(onboarding.client_instruction).toContain('RealtyCalendar');
    expect(onboarding.client_instruction).toContain('Пароли в Telegram отправлять не нужно');
  });

  it('creates Bnovo onboarding with Bnovo-specific instruction', () => {
    const onboarding = buildChannelManagerOnboarding('Bnovo', '2026-06-14T10:00:00.000Z');

    expect(onboarding.status).toBe('needs_access');
    expect(onboarding.checklist.length).toBeGreaterThan(0);
    expect(onboarding.client_instruction).toContain('Bnovo');
  });

  it('marks unknown manager as requiring a manual call', () => {
    const onboarding = buildChannelManagerOnboarding('Другой', '2026-06-14T10:00:00.000Z');

    expect(onboarding.status).toBe('blocked_manual_call');
    expect(onboarding.manual_call_needed).toBe(true);
    expect(onboarding.manual_call_reason).toContain('Нужно уточнить');
  });

  it('updates status, test object and admin note inside answers_json', () => {
    const answers = updateChannelManagerOnboarding(
      { pms: ['TravelLine'] },
      {
        status: 'ready_for_setup',
        testObject: { name: 'Апартамент 1', external_id: 'tl-101', notes: 'Проверить каналы' },
        adminNote: 'Клиент готовит доступ.',
        now: '2026-06-14T10:00:00.000Z',
      },
    );

    expect(answers.channel_manager_onboarding).toMatchObject({
      manager: 'TravelLine',
      status: 'ready_for_setup',
      test_object: {
        name: 'Апартамент 1',
        external_id: 'tl-101',
        notes: 'Проверить каналы',
      },
      admin_note: 'Клиент готовит доступ.',
    });
  });

  it('formats onboarding status labels in Russian', () => {
    expect(formatChannelManagerOnboardingStatus('needs_access')).toBe('нужен доступ');
    expect(formatChannelManagerOnboardingStatus('ready_for_setup')).toBe('готов к настройке');
    expect(formatChannelManagerOnboardingStatus('blocked_manual_call')).toBe('нужен ручной созвон');
    expect(formatChannelManagerOnboardingStatus('completed')).toBe('подключение завершено');
  });
});
