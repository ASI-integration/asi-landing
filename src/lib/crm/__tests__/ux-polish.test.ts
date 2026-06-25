import { describe, expect, it, vi, afterEach } from 'vitest';
import { providerAvailabilityLabelRu } from '@/lib/channel-connections/labels';
import { applySelectMethod, initialConnectionState } from '@/lib/channel-manager-connection/flow';
import { isCrmOperatorEmail } from '@/lib/crm/access';
import {
  formatCrmContactNameForDisplay,
  isWizardAcceptanceCrmContact,
} from '@/lib/crm/contact-display';
import { sanitizeCrmMessageTextForDisplay } from '@/lib/crm/message-display';
import {
  buildQueueItem,
  CRM_QUEUE_STATUS_LABELS,
} from '@/lib/crm/queue';
import type { CrmContact, CrmOnboardingStatus } from '@/lib/crm/types';

const baseContact: CrmContact = {
  id: 'c-ux',
  name: 'Тест Владелец',
  phone: '+7 900 000-00-00',
  telegramUsername: 'test_owner',
  email: null,
  role: 'owner',
  source: 'telegram',
  objectsCount: 1,
  city: 'Москва',
  note: '',
  status: 'contact',
  communicationStatus: 'waiting_reply',
  lastContactAt: '2026-06-19T10:00:00.000Z',
  nextStep: '',
  nextActionAt: null,
  createdAt: '2026-06-18T10:00:00.000Z',
  updatedAt: '2026-06-19T10:00:00.000Z',
};

function withOnboarding(status: CrmOnboardingStatus): CrmContact {
  return {
    ...baseContact,
    onboarding: {
      status,
      statusLabel: status,
      missing: [],
      lastMessage: '[photo]',
      channelManagerHref: '/dashboard/channel-connections',
      readinessPercent: 100,
      readinessStatusLabel: 'Готов к менеджеру каналов',
      nextBestStep: 'Открыть менеджер каналов',
      missingOptional: [],
    },
  };
}

describe('crm/channel manager ux polish', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('shows Russian foundation badge instead of Foundation', () => {
    expect(providerAvailabilityLabelRu('foundation')).toBe('Базовый слой');
    expect(providerAvailabilityLabelRu('foundation')).not.toContain('Foundation');
  });

  it('uses lowercase менеджер каналов in queue labels', () => {
    expect(CRM_QUEUE_STATUS_LABELS.channel_manager_started).toBe('менеджер каналов открыт');
    const item = buildQueueItem(withOnboarding('ready_for_channel_manager'));
    expect(item.onboardingStatusLabel).toContain('менеджеру каналов');
    expect(item.nextBestStep).toContain('Открыть менеджер каналов');
  });

  it('shows Russian display name for wizard acceptance contacts', () => {
    expect(
      formatCrmContactNameForDisplay('Wizard Acceptance', 'wizard_accept_v2'),
    ).toBe('Заявка автопроверки');
    expect(isWizardAcceptanceCrmContact({ name: 'Wizard Acceptance', telegramUsername: 'wizard_accept_v2' })).toBe(true);
  });

  it('hides [photo] technical marker from CRM queue preview', () => {
    const item = buildQueueItem(withOnboarding('onboarding_started'));
    expect(item.lastMessagePreview).toBeNull();
    expect(sanitizeCrmMessageTextForDisplay('[photo]')).toBeNull();
    expect(sanitizeCrmMessageTextForDisplay('Привет [photo] мир')).toBe('Привет мир');
  });

  it('saves RealtyCalendar method selection in connection flow', () => {
    const next = applySelectMethod(
      initialConnectionState({ objectId: 'OBJ-1', contactId: 'c-1' }),
      'realtycalendar',
    );
    expect(next.method).toBe('realtycalendar');
    expect(next.status).toBe('ready_to_connect');
  });

  it('allows internal ASI emails for CRM in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRM_OPERATOR_EMAILS', '');
    vi.stubEnv('OPERATOR_EMAIL', '');

    expect(isCrmOperatorEmail('operator@asi-global.ru')).toBe(true);
    expect(isCrmOperatorEmail('owner@gmail.com')).toBe(false);
  });

  it('respects explicit CRM operator allowlist in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRM_OPERATOR_EMAILS', 'pilot@example.com');
    vi.stubEnv('OPERATOR_EMAIL', '');

    expect(isCrmOperatorEmail('pilot@example.com')).toBe(true);
    expect(isCrmOperatorEmail('operator@asi-global.ru')).toBe(false);
  });
});
