import { describe, expect, it } from 'vitest';
import type { CrmContact } from '@/lib/crm/types';
import type { OpsOperatorTask } from '@/lib/ops-board/types';
import { OPS_PILOT_STALLED_DAYS } from '@/lib/ops-pilot/constants';
import { buildOpsPilotParticipantSnapshot } from '@/lib/ops-pilot/snapshot';
import { buildOperatorActionPatch, filterPilotParticipantContacts } from '@/lib/ops-pilot/service';

function baseContact(overrides: Partial<CrmContact> = {}): CrmContact {
  return {
    id: 'contact-1',
    name: 'Иван Пилот',
    phone: '+79990001122',
    telegramUsername: 'ivan_pilot',
    email: null,
    role: 'owner',
    source: 'form',
    objectsCount: 1,
    city: 'Санкт-Петербург',
    note: '',
    status: 'onboarding',
    communicationStatus: 'replied',
    lastContactAt: '2026-06-24T10:00:00.000Z',
    nextStep: '',
    nextActionAt: null,
    createdAt: '2026-06-20T10:00:00.000Z',
    updatedAt: '2026-06-24T10:00:00.000Z',
    ...overrides,
  };
}

function opsTask(overrides: Partial<OpsOperatorTask> = {}): OpsOperatorTask {
  return {
    id: 'ops-1',
    taskType: 'verify_channel_manager',
    taskStatus: 'new',
    priority: 'normal',
    source: 'crm',
    title: 'Проверить подключение Менеджера Каналов',
    description: 'Тест',
    objectId: 'pilot_spb_1',
    contactId: 'contact-1',
    guestName: null,
    ownerName: 'Иван Пилот',
    objectLabel: 'Объект',
    lastEventText: 'Проверить',
    lastEventAt: '2026-06-24T12:00:00.000Z',
    dedupKey: 'auto:pilot_chain:contact-1:pilot_spb_1:verify_channel_manager',
    metadata: { integration: 'pilot_chain' },
    createdAt: '2026-06-24T12:00:00.000Z',
    updatedAt: '2026-06-24T12:00:00.000Z',
    closedAt: null,
    ...overrides,
  };
}

describe('ops-pilot snapshot', () => {
  it('показывает новый лид без объекта', () => {
    const snapshot = buildOpsPilotParticipantSnapshot(
      baseContact({ status: 'invited', ownerObjects: undefined }),
      [],
    );
    expect(snapshot.stage).toBe('access_received');
    expect(snapshot.blockers.some((item) => item.key === 'no_linked_object')).toBe(true);
    expect(snapshot.nextActionRu).toContain('Создать объект');
    expect(snapshot.links.crmHref).toContain('/dashboard/crm');
  });

  it('показывает дозаполнение при нехватке полей', () => {
    const snapshot = buildOpsPilotParticipantSnapshot(
      baseContact({
        ownerObjects: [{ objectId: 'pilot_spb_1', title: 'Квартира', readinessPercent: 40, isActiveSession: true }],
        onboarding: {
          status: 'missing_required_data',
          statusLabel: 'не хватает',
          missing: ['wifi'],
          lastMessage: '',
          channelManagerHref: null,
          readinessPercent: 40,
          readinessStatusLabel: 'Не хватает данных',
          nextBestStep: 'Добавить Wi-Fi',
          missingOptional: [],
          objectType: 'квартира',
          checkinTime: '14:00',
          checkoutTime: '12:00',
          channels: ['Avito'],
          rules: ['тишина'],
        },
      }),
      [],
    );
    expect(snapshot.stage).toBe('object_filling');
    expect(snapshot.nextActionRu).toContain('Дозаполнить');
    expect(snapshot.links.objectHref).toContain('pilot_spb_1');
  });

  it('показывает OPS-задачу и ссылки при готовности к МК', () => {
    const contact = baseContact({
      ownerObjects: [{ objectId: 'pilot_spb_1', title: 'Квартира', readinessPercent: 100, isActiveSession: true }],
      onboarding: {
        status: 'ready_for_channel_manager',
        statusLabel: 'готов',
        missing: [],
        lastMessage: '',
        channelManagerHref: '/dashboard/channel-connections?objectId=pilot_spb_1&contactId=contact-1',
        readinessPercent: 100,
        readinessStatusLabel: 'Готов к менеджеру каналов',
        nextBestStep: 'Открыть менеджер каналов',
        missingOptional: [],
        objectType: 'квартира',
        checkinTime: '14:00',
        checkoutTime: '12:00',
        channels: ['Avito'],
        rules: ['тишина'],
        wifiName: 'WiFi',
        wifiPassword: 'pass',
        photosCount: 1,
      },
      channelManagerConnection: {
        objectId: 'pilot_spb_1',
        contactId: 'contact-1',
        method: null,
        customManagerName: null,
        accessSituation: null,
        status: 'ready_to_connect',
        nextStepRu: 'Выберите способ подключения каналов.',
        updatedAt: '2026-06-24T11:00:00.000Z',
      },
    });
    const snapshot = buildOpsPilotParticipantSnapshot(contact, [opsTask()]);
    expect(snapshot.stage).toBe('ops_task_created');
    expect(snapshot.opsTask?.id).toBe('ops-1');
    expect(snapshot.links.channelManagerHref).toContain('channel-connections');
    expect(snapshot.links.opsTaskHref).toContain('taskId=ops-1');
    expect(snapshot.nextActionRu).toBe('Проверить OPS-задачу');
  });

  it('отмечает застрявшего участника', () => {
    const staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - (OPS_PILOT_STALLED_DAYS + 1));
    const snapshot = buildOpsPilotParticipantSnapshot(
      baseContact({
        updatedAt: staleDate.toISOString(),
        lastContactAt: staleDate.toISOString(),
        ownerObjects: [{ objectId: 'pilot_spb_1', title: 'Квартира', readinessPercent: 20, isActiveSession: false }],
        onboarding: {
          status: 'missing_required_data',
          statusLabel: '',
          missing: ['address'],
          lastMessage: '',
          channelManagerHref: null,
          readinessPercent: 20,
          readinessStatusLabel: 'Не хватает данных',
          nextBestStep: 'Адрес',
          missingOptional: [],
        },
      }),
      [],
    );
    expect(snapshot.isStalled).toBe(true);
    expect(snapshot.blockers.some((item) => item.key === 'stalled')).toBe(true);
  });

  it('переводит в ручной контроль по communicationStatus', () => {
    const snapshot = buildOpsPilotParticipantSnapshot(
      baseContact({ communicationStatus: 'needs_manual_reaction' }),
      [],
    );
    expect(snapshot.stage).toBe('needs_manual_control');
    expect(snapshot.needsManualHelp).toBe(true);
  });
});

describe('ops-pilot service', () => {
  it('фильтрует только пилотных участников', () => {
    const contacts = [
      baseContact({ id: '1', status: 'onboarding' }),
      baseContact({ id: '2', status: 'active_pilot' }),
      baseContact({ id: '3', status: 'waitlist' }),
      baseContact({ id: '4', status: 'new' }),
    ];
    const filtered = filterPilotParticipantContacts(contacts);
    expect(filtered.map((item) => item.id)).toEqual(['1', '2']);
  });

  it('строит безопасные патчи операторских действий', () => {
    expect(buildOperatorActionPatch('mark_manual_control')).toEqual({
      communicationStatus: 'needs_manual_reaction',
    });
    expect(buildOperatorActionPatch('mark_waiting_owner')).toEqual({
      communicationStatus: 'waiting_reply',
    });
    expect(buildOperatorActionPatch('add_note', 'Позвонить завтра')).toEqual({
      nextStep: 'Позвонить завтра',
    });
  });
});
