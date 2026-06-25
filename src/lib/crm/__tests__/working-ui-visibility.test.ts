import { describe, expect, it } from 'vitest';
import type { CrmContact } from '@/lib/crm/types';
import type { OpsOperatorTask } from '@/lib/ops-board/types';
import {
  filterWorkingUiCrmContacts,
  filterWorkingUiOpsTasks,
  isHiddenWorkingUiCrmContact,
  isHiddenWorkingUiOpsTask,
} from '@/lib/crm/working-ui-visibility';

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

function baseOpsTask(overrides: Partial<OpsOperatorTask> = {}): OpsOperatorTask {
  return {
    id: 'ops-1',
    taskType: 'verify_channel_manager',
    taskStatus: 'new',
    priority: 'normal',
    source: 'crm',
    title: 'Проверить подключение',
    description: 'Рабочая задача',
    objectId: 'obj-1',
    contactId: 'contact-1',
    guestName: null,
    ownerName: 'Иван Пилот',
    objectLabel: 'Квартира',
    lastEventText: '',
    lastEventAt: null,
    dedupKey: 'auto:crm:contact-1:verify_channel_manager',
    metadata: {},
    createdAt: '2026-06-24T12:00:00.000Z',
    updatedAt: '2026-06-24T12:00:00.000Z',
    closedAt: null,
    ...overrides,
  };
}

describe('working-ui visibility', () => {
  it('скрывает acceptance и test CRM-записи из рабочих списков', () => {
    expect(
      isHiddenWorkingUiCrmContact(
        baseContact({ name: 'ASI_PILOT_CHAIN_ACCEPTANCE_run_1' }),
      ),
    ).toBe(true);
    expect(
      isHiddenWorkingUiCrmContact(
        baseContact({ telegramUsername: 'wizard_accept_v2', name: 'Wizard Acceptance' }),
      ),
    ).toBe(true);
    expect(
      isHiddenWorkingUiCrmContact(
        baseContact({ telegramUsername: 'pilot_chain_abc', name: 'Telegram guest' }),
      ),
    ).toBe(true);
    expect(isHiddenWorkingUiCrmContact(baseContact({ name: 'Telegram guest', source: 'other' }))).toBe(
      true,
    );
    expect(isHiddenWorkingUiCrmContact(baseContact())).toBe(false);
  });

  it('оставляет реальные заявки в рабочем списке', () => {
    const contacts = [
      baseContact({ id: 'real-1' }),
      baseContact({ id: 'test-1', name: 'ASI_PILOT_CHAIN_ACCEPTANCE_x' }),
      baseContact({ id: 'real-2', name: 'Мария', status: 'invited' }),
    ];
    expect(filterWorkingUiCrmContacts(contacts).map((item) => item.id)).toEqual(['real-1', 'real-2']);
    expect(filterWorkingUiCrmContacts(contacts, { includeTest: true })).toHaveLength(3);
  });

  it('скрывает acceptance OPS-задачи, но не рабочие pilot_chain-задачи', () => {
    expect(
      isHiddenWorkingUiOpsTask(
        baseOpsTask({
          ownerName: 'ASI_PILOT_CHAIN_ACCEPTANCE_x',
          dedupKey: 'auto:pilot_chain:contact-1:obj-1:verify_channel_manager',
          metadata: { integration: 'pilot_chain' },
        }),
      ),
    ).toBe(true);
    expect(
      isHiddenWorkingUiOpsTask(
        baseOpsTask({
          ownerName: 'Иван Пилот',
          dedupKey: 'auto:pilot_chain:contact-1:obj-1:verify_channel_manager',
          metadata: { integration: 'pilot_chain' },
        }),
      ),
    ).toBe(false);
    expect(filterWorkingUiOpsTasks([baseOpsTask(), baseOpsTask({ id: 'ops-2', ownerName: 'ASI_TG_OPS_ACCEPTANCE_1' })])).toHaveLength(1);
  });
});
