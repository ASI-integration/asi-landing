import { describe, expect, it } from 'vitest';
import {
  applyCustomManagerName,
  applySelectAccess,
  applySelectMethod,
  buildChannelManagerConnectionHref,
  initialConnectionState,
  isReadyForChannelManagerFlow,
  resolveChannelManagerQueueSummary,
} from '../flow';
import {
  buildChannelManagerConnectionBlock,
  mergeChannelManagerConnectionIntoNote,
  parseChannelManagerConnectionBlock,
} from '../note-block';
import { buildQueueItem } from '@/lib/crm/queue';
import { buildActivityFeed } from '@/lib/crm/activity-feed';
import type { CrmContact } from '@/lib/crm/types';

describe('channel manager connection flow', () => {
  it('builds object-specific href for CRM and Telegram', () => {
    expect(
      buildChannelManagerConnectionHref({
        objectId: 'OBJ-42',
        contactId: 'contact-1',
        source: 'crm_queue',
      }),
    ).toBe('/dashboard/channel-connections?objectId=OBJ-42&source=crm_queue&contactId=contact-1');
  });

  it('allows ready_for_channel_manager object into flow', () => {
    expect(
      isReadyForChannelManagerFlow({
        objectId: 'OBJ-1',
        contactId: 'c-1',
        objectTitle: 'Квартира',
        readinessPercent: 100,
        onboardingStatus: 'ready_for_channel_manager',
      }),
    ).toBe(true);
  });

  it('blocks object without readiness 100%', () => {
    expect(
      isReadyForChannelManagerFlow({
        objectId: 'OBJ-1',
        contactId: 'c-1',
        objectTitle: 'Квартира',
        readinessPercent: 80,
        onboardingStatus: 'missing_required_data',
      }),
    ).toBe(false);
  });

  it('saves RealtyCalendar method selection', () => {
    const state = applySelectMethod(initialConnectionState({ objectId: 'OBJ-1', contactId: 'c-1' }), 'realtycalendar');
    expect(state.method).toBe('realtycalendar');
    expect(state.nextStepRu).toContain('RealtyCalendar');
  });

  it('saves Bnovo method selection', () => {
    const state = applySelectMethod(initialConnectionState({ objectId: 'OBJ-1', contactId: 'c-1' }), 'bnovo');
    expect(state.method).toBe('bnovo');
    expect(state.status).toBe('ready_to_connect');
  });

  it('saves custom channel manager name', () => {
    const state = applyCustomManagerName(
      applySelectMethod(initialConnectionState({ objectId: 'OBJ-1', contactId: 'c-1' }), 'other'),
      'TravelLine',
    );
    expect(state.customManagerName).toBe('TravelLine');
    expect(state.status).toBe('prepared');
  });

  it('saves none_yet as primary setup needed', () => {
    const state = applySelectMethod(initialConnectionState({ objectId: 'OBJ-1', contactId: 'c-1' }), 'none_yet');
    expect(state.status).toBe('primary_setup_needed');
    expect(resolveChannelManagerQueueSummary(state).statusLabel).toBe('Нужна первичная настройка');
  });

  it('maps waiting access to CRM queue summary', () => {
    let state = applySelectMethod(initialConnectionState({ objectId: 'OBJ-1', contactId: 'c-1' }), 'realtycalendar');
    state = applySelectAccess(state, 'from_scratch');
    const summary = resolveChannelManagerQueueSummary(state);
    expect(summary.statusLabel).toBe('Ждём доступы RealtyCalendar');
    expect(summary.methodLabel).toBe('RealtyCalendar');
  });

  it('round-trips connection block in CRM note', () => {
    const state = applySelectAccess(
      applySelectMethod(initialConnectionState({ objectId: 'OBJ-9', contactId: 'c-9' }), 'bnovo'),
      'has_access',
    );
    const note = mergeChannelManagerConnectionIntoNote('Онбординг ASI\nСтатус: ready_for_channel_manager', state);
    const parsed = parseChannelManagerConnectionBlock(note);
    expect(parsed?.method).toBe('bnovo');
    expect(parsed?.accessSituation).toBe('has_access');
    expect(buildChannelManagerConnectionBlock(state)).toContain('Способ: bnovo');
  });
});

describe('channel manager CRM integration', () => {
  const readyContact: CrmContact = {
    id: 'c-ready',
    name: 'Владелец',
    phone: '',
    telegramUsername: 'owner',
    email: null,
    role: 'owner',
    source: 'telegram',
    objectsCount: 1,
    city: 'Сочи',
    note: [
      'Онбординг ASI',
      'object_id=OBJ-77',
      'Статус: ready_for_channel_manager',
      'Готовность: 100%',
      'Менеджер каналов: /dashboard/channel-connections?objectId=OBJ-77&source=crm_queue&contactId=c-ready',
      '',
      'Подключение МК ASI',
      'object_id=OBJ-77',
      'contact_id=c-ready',
      'Способ: realtycalendar',
      'Доступ: from_scratch',
      'Статус: waiting_access',
      'Следующий шаг: Ждём доступы RealtyCalendar.',
    ].join('\n'),
    status: 'object_setup',
    communicationStatus: 'waiting_reply',
    lastContactAt: '2026-06-20T10:00:00.000Z',
    nextStep: '',
    nextActionAt: null,
    createdAt: '2026-06-19T10:00:00.000Z',
    updatedAt: '2026-06-20T10:00:00.000Z',
    onboarding: {
      status: 'channel_manager_started',
      statusLabel: 'channel_manager_started',
      missing: [],
      lastMessage: 'готово',
      channelManagerHref: '/dashboard/channel-connections?objectId=OBJ-77&source=crm_queue&contactId=c-ready',
      readinessPercent: 100,
      readinessStatusLabel: 'Готов к Менеджеру каналов',
      nextBestStep: 'Выберите способ',
      missingOptional: [],
    },
    channelManagerConnection: {
      objectId: 'OBJ-77',
      contactId: 'c-ready',
      method: 'realtycalendar',
      customManagerName: null,
      accessSituation: 'from_scratch',
      status: 'waiting_access',
      nextStepRu: 'Ждём доступы RealtyCalendar.',
      updatedAt: '2026-06-20T10:00:00.000Z',
    },
  };

  it('shows channel manager status and method in CRM queue', () => {
    const item = buildQueueItem(readyContact);
    expect(item.channelManagerStatus).toBe('Ждём доступы RealtyCalendar');
    expect(item.channelManagerMethod).toBe('RealtyCalendar');
    expect(item.channelManagerHref).toContain('objectId=OBJ-77');
    expect(item.channelManagerHref).toContain('contactId=c-ready');
  });

  it('maps channel manager events into activity feed', () => {
    const feed = buildActivityFeed([readyContact], [
      {
        id: 'e-1',
        contact_id: 'c-ready',
        event_type: 'channel_manager_method_selected',
        message_text: 'Выбран способ подключения: RealtyCalendar',
        metadata: { method_label: 'RealtyCalendar', object_id: 'OBJ-77' },
        created_at: '2026-06-20T10:05:00.000Z',
      },
    ]);
    expect(feed.some((entry) => entry.label.includes('RealtyCalendar'))).toBe(true);
  });
});
