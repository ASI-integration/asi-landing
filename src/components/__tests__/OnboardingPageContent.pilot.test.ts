import { describe, expect, it } from 'vitest';
import {
  extractCrmContactIdFromPropertiesPath,
  isPilotConnectRedirect,
  PILOT_CONNECT_COPY,
} from '@/lib/crm/pilot-onboarding';

const CONTACT_ID = '6c9f99b1-726c-4fcf-d428-bcb23d84df20';

describe('/connect pilot redirect copy gate', () => {
  it('enables pilot connect copy for properties redirect', () => {
    expect(isPilotConnectRedirect('/dashboard/properties')).toBe(true);
    expect(isPilotConnectRedirect(`/dashboard/properties?crmContactId=${CONTACT_ID}`)).toBe(true);
    expect(isPilotConnectRedirect('/dashboard')).toBe(false);
    expect(isPilotConnectRedirect('/connect')).toBe(false);
  });

  it('exposes updated pilot connect copy', () => {
    expect(PILOT_CONNECT_COPY.title).toBe('Войти в кабинет ASI');
    expect(PILOT_CONNECT_COPY.subtitle).toContain('закрытом пилоте ASI');
    expect(PILOT_CONNECT_COPY.infoTitle).toBe('Пилотное подключение');
    expect(PILOT_CONNECT_COPY.infoBody).toContain('Telegram-бот');
    expect(PILOT_CONNECT_COPY.signupCta).toBe('Создать аккаунт и продолжить');
  });

  it('extracts crmContactId from pilot properties redirect', () => {
    expect(extractCrmContactIdFromPropertiesPath(`/dashboard/properties?crmContactId=${CONTACT_ID}`)).toBe(
      CONTACT_ID,
    );
    expect(extractCrmContactIdFromPropertiesPath('/dashboard/properties')).toBeNull();
    expect(extractCrmContactIdFromPropertiesPath('/dashboard')).toBeNull();
  });
});
