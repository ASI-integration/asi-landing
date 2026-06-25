/**
 * Focused pilot chain tests: CRM → объект → МК → OPS.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrmContact } from '@/lib/crm/types';
import { computeObjectReadiness } from '@/lib/object-readiness/engine';
import { parseChannelManagerConnectionBlock } from '@/lib/channel-manager-connection/note-block';

const contacts = new Map<string, CrmContact>();
const crmEvents: Record<string, unknown>[] = [];
const opsTasks: Record<string, unknown>[] = [];
let pilotKnowledgeRows: Record<string, unknown>[] = [];

function baseContact(overrides: Partial<CrmContact> = {}): CrmContact {
  return {
    id: 'contact-1',
    name: 'Иван Пилот',
    phone: '+79001234567',
    telegramUsername: 'ivan_pilot',
    email: null,
    role: 'owner',
    source: 'manual',
    objectsCount: 0,
    city: 'Санкт-Петербург',
    note: 'Заметка оператора',
    status: 'onboarding',
    communicationStatus: 'no_contact',
    lastContactAt: null,
    nextStep: '',
    nextActionAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ownerObjects: [],
    onboarding: null,
    channelManagerConnection: null,
    ...overrides,
  };
}

function rowToContact(row: Record<string, unknown>): CrmContact {
  const note = String(row.notes ?? '');
  const ownerObjects = parseOwnerObjectsFromNote(note);
  return {
    id: String(row.id),
    name: String(row.name),
    phone: String(row.phone ?? ''),
    telegramUsername: String(row.telegram_username ?? ''),
    email: (row.email as string | null) ?? null,
    role: 'owner',
    source: 'manual',
    objectsCount: Number(row.property_count ?? ownerObjects.length),
    city: String(row.city ?? ''),
    note,
    status: row.status as CrmContact['status'],
    communicationStatus: 'no_contact',
    lastContactAt: null,
    nextStep: String(row.next_action ?? ''),
    nextActionAt: null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    ownerObjects,
    onboarding: parseOnboardingFromNote(note),
    channelManagerConnection: parseChannelManagerConnectionBlock(note),
    activeObjectTitle: ownerObjects[0]?.title ?? null,
  };
}

function parseOwnerObjectsFromNote(note: string) {
  const lines = note.split('\n');
  const start = lines.findIndex((line) => line.trim() === 'Объекты владельца');
  if (start === -1) return [];
  const objects = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) break;
    const match = line.match(
      /^((?:OBJ-\d+)|(?:pilot_[a-zA-Z0-9_-]+))\s*\|\s*(.+?)\s*\|\s*готовность:\s*(\d+)%\s*\|\s*активная сессия:\s*(да|нет)$/i,
    );
    if (!match) continue;
    objects.push({
      objectId: match[1],
      title: match[2].trim(),
      readinessPercent: Number(match[3]),
      isActiveSession: match[4].toLowerCase() === 'да',
    });
  }
  return objects;
}

function parseOnboardingFromNote(note: string) {
  const lines = note.split('\n').map((line) => line.trim());
  const start = lines.findIndex((line) => line === 'Онбординг ASI');
  if (start === -1) return null;
  const get = (prefix: string) => {
    const line = lines.slice(start + 1).find((item) => item.startsWith(prefix));
    return line ? line.slice(prefix.length).trim() : '';
  };
  const statusRaw = get('Статус:');
  const allowed = ['onboarding_started', 'missing_required_data', 'ready_for_channel_manager', 'channel_manager_started', 'needs_operator'];
  if (!allowed.includes(statusRaw)) return null;
  return {
    status: statusRaw as 'onboarding_started',
    statusLabel: statusRaw,
    missing: get('Не хватает:') === 'ничего' ? [] : get('Не хватает:').split(',').map((s) => s.trim()),
    lastMessage: get('Последнее сообщение:'),
    channelManagerHref: get('Менеджер каналов:') || null,
    readinessPercent: Number(get('Готовность:').replace('%', '')) || null,
    readinessStatusLabel: get('Статус готовности:') || null,
    nextBestStep: get('Следующий шаг:') || null,
    missingOptional: [],
    objectType: get('Тип объекта:') || null,
    checkinTime: get('Заезд:') || null,
    checkoutTime: get('Выезд:') || null,
    channels: [],
    rules: [],
    wifiName: null,
    wifiPassword: null,
    photosCount: null,
  };
}

vi.mock('@/lib/communication/pilot-object-intake', () => ({
  createPilotObjectId: () => 'pilot_spb_test_abc123',
}));

vi.mock('@/lib/pilot-readiness/repository', () => ({
  upsertPilotObjectKnowledge: vi.fn(async (input: { property_id: string }) => {
    pilotKnowledgeRows.push(input);
    return { ok: true };
  }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'crm_events') {
        return {
          insert: async (row: Record<string, unknown>) => {
            crmEvents.push(row);
            return { error: null };
          },
        };
      }
      if (table === 'ops_operator_tasks') {
        return {
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                const dedup = String(row.dedup_key ?? '');
                const existing = opsTasks.find(
                  (task) =>
                    task.dedup_key === dedup &&
                    ['new', 'in_progress', 'waiting_owner', 'needs_operator'].includes(String(task.task_status)),
                );
                if (existing) {
                  return { data: null, error: { message: 'duplicate' } };
                }
                const created = { id: `ops-${opsTasks.length + 1}`, ...row };
                opsTasks.push(created);
                return { data: created, error: null };
              },
            }),
          }),
          select: () => ({
            eq: (col: string, val: unknown) => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => {
                    const match = [...opsTasks]
                      .reverse()
                      .find((task) => task[col] === val);
                    return { data: match ?? null, error: null };
                  },
                }),
              }),
              maybeSingle: async () => {
                const match = opsTasks.find((task) => task[col] === val);
                return { data: match ?? null, error: null };
              },
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  },
}));

vi.mock('@/lib/crm/repository', () => ({
  getCrmContactById: vi.fn(async (id: string) => contacts.get(id) ?? null),
  updateCrmContact: vi.fn(async (id: string, patch: Partial<CrmContact> & { note?: string; objectsCount?: number; nextStep?: string }) => {
    const current = contacts.get(id);
    if (!current) throw new Error('not found');
    const notes = patch.note ?? current.note;
    const row = {
      id,
      name: current.name,
      phone: current.phone,
      telegram_username: current.telegramUsername,
      email: current.email,
      role: current.role,
      source: current.source,
      property_count: patch.objectsCount ?? current.objectsCount,
      city: current.city,
      notes,
      status: patch.status ?? current.status,
      next_action: patch.nextStep ?? current.nextStep,
      created_at: current.createdAt,
      updated_at: new Date().toISOString(),
    };
    const updated = rowToContact(row);
    contacts.set(id, updated);
    return updated;
  }),
  listCrmContacts: vi.fn(async () => [...contacts.values()]),
}));

import { shouldAutoProvisionObjectFromLead } from '@/lib/pilot-chain/status-triggers';
import {
  buildOnboardingNoteBlock,
  buildOwnerObjectsNoteBlock,
  extractLinkedObjectId,
  mergePilotChainNoteBlocks,
} from '@/lib/pilot-chain/note-blocks';
import { ensureLeadObjectDraft } from '@/lib/pilot-chain/lead-to-object';
import { prepareChannelManagerDraft } from '@/lib/pilot-chain/object-to-channel-manager';
import { ensureOpsCaseForChannelSetup } from '@/lib/pilot-chain/channel-manager-to-ops';
import { resolvePilotChainNextActions } from '@/lib/pilot-chain/next-actions';
import { runPilotChainForContact } from '@/lib/pilot-chain/orchestrator';

describe('pilot-chain status triggers', () => {
  it('включает onboarding и access_received', () => {
    expect(shouldAutoProvisionObjectFromLead('onboarding')).toBe(true);
    expect(shouldAutoProvisionObjectFromLead('access_received')).toBe(true);
    expect(shouldAutoProvisionObjectFromLead('object_setup')).toBe(true);
    expect(shouldAutoProvisionObjectFromLead('new')).toBe(false);
  });
});

describe('pilot-chain note blocks', () => {
  it('парсит pilot_* в блоке объектов владельца', () => {
    const block = buildOwnerObjectsNoteBlock([
      { objectId: 'pilot_spb_test_abc', title: 'Квартира', readinessPercent: 20, isActiveSession: true },
    ]);
    expect(block).toContain('pilot_spb_test_abc');
    const merged = mergePilotChainNoteBlocks({
      existingNote: 'ручная заметка',
      ownerObjects: [{ objectId: 'pilot_spb_test_abc', title: 'Квартира', readinessPercent: 20, isActiveSession: true }],
      onboardingBlock: 'Онбординг ASI\nobject_id=pilot_spb_test_abc',
    });
    expect(merged).toContain('Объекты владельца');
    expect(merged).toContain('Онбординг ASI');
    expect(extractLinkedObjectId(rowToContact({ id: 'c', notes: merged, name: 'x', status: 'onboarding', created_at: '', updated_at: '' }))).toBe(
      'pilot_spb_test_abc',
    );
  });
});

describe('pilot-chain lead to object', () => {
  beforeEach(() => {
    contacts.clear();
    crmEvents.length = 0;
    pilotKnowledgeRows = [];
    contacts.set('contact-1', baseContact());
  });

  it('создаёт объект один раз при onboarding', async () => {
    const first = await ensureLeadObjectDraft(baseContact());
    expect(first.step.outcome).toBe('created');
    expect(first.objectId).toBe('pilot_spb_test_abc123');
    expect(pilotKnowledgeRows).toHaveLength(1);
    expect(crmEvents.some((event) => event.event_type === 'lead_to_object_created')).toBe(true);

    const second = await ensureLeadObjectDraft(first.contact);
    expect(second.step.outcome).toBe('skipped');
    expect(crmEvents.some((event) => event.event_type === 'skipped_existing_object')).toBe(true);
    expect(pilotKnowledgeRows).toHaveLength(1);
  });
});

describe('pilot-chain object to channel manager', () => {
  beforeEach(() => {
    contacts.clear();
    crmEvents.length = 0;
  });

  it('готовит черновик МК без дубля', async () => {
    const contact = baseContact({
      note: [
        'Объекты владельца',
        'pilot_spb_x | Объект | готовность: 10% | активная сессия: да',
        '',
        'Онбординг ASI',
        'object_id=pilot_spb_x',
      ].join('\n'),
      ownerObjects: [{ objectId: 'pilot_spb_x', title: 'Объект', readinessPercent: 10, isActiveSession: true }],
    });
    contacts.set(contact.id, contact);

    const first = await prepareChannelManagerDraft(contact, 'pilot_spb_x');
    expect(first.step.outcome).toBe('created');
    expect(first.contact.note).toContain('Подключение МК ASI');
    expect(crmEvents.some((event) => event.event_type === 'object_to_channel_manager_prepared')).toBe(true);

    const second = await prepareChannelManagerDraft(first.contact, 'pilot_spb_x');
    expect(second.step.outcome).toBe('skipped');
  });
});

describe('pilot-chain channel manager to ops', () => {
  beforeEach(() => {
    opsTasks.length = 0;
    crmEvents.length = 0;
  });

  it('создаёт OPS один раз при готовности к МК', async () => {
    const readiness = computeObjectReadiness({
      address: 'СПб',
      object_type: 'квартира',
      checkin_time: '14:00',
      checkout_time: '12:00',
      channels: ['Avito'],
      rules: ['не курить'],
      wifi_name: 'WiFi',
      photos_intent: 'later',
      onboardingStatus: 'ready_for_channel_manager',
    });
    const contact = baseContact({
      onboarding: {
        status: 'ready_for_channel_manager',
        statusLabel: 'готов',
        missing: [],
        lastMessage: '',
        channelManagerHref: '/dashboard/channel-connections?objectId=pilot_x',
        readinessPercent: readiness.readiness_percent,
        readinessStatusLabel: readiness.readiness_status_label_ru,
        nextBestStep: readiness.next_best_step_ru,
        missingOptional: [],
        objectType: 'квартира',
        checkinTime: '14:00',
        checkoutTime: '12:00',
        channels: ['Avito'],
        rules: ['не курить'],
        wifiName: 'WiFi',
        wifiPassword: 'pass',
        photosCount: 1,
      },
      channelManagerConnection: {
        objectId: 'pilot_x',
        contactId: 'contact-1',
        method: null,
        customManagerName: null,
        accessSituation: null,
        status: 'ready_to_connect',
        nextStepRu: 'Выберите способ',
        updatedAt: null,
      },
    });

    const first = await ensureOpsCaseForChannelSetup(contact, 'pilot_x');
    expect(first.step.outcome).toBe('created');
    expect(opsTasks).toHaveLength(1);

    const second = await ensureOpsCaseForChannelSetup(contact, 'pilot_x');
    expect(second.step.outcome).toBe('skipped');
    expect(opsTasks).toHaveLength(1);
  });
});

describe('pilot-chain next actions UI', () => {
  it('показывает цепочку шагов для связанного объекта', () => {
    const contact = baseContact({
      ownerObjects: [{ objectId: 'pilot_x', title: 'Объект', readinessPercent: 100, isActiveSession: true }],
      onboarding: {
        status: 'ready_for_channel_manager',
        statusLabel: '',
        missing: [],
        lastMessage: '',
        channelManagerHref: '/dashboard/channel-connections?objectId=pilot_x&contactId=contact-1',
        readinessPercent: 100,
        readinessStatusLabel: 'Готов',
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
    });

    const actions = resolvePilotChainNextActions(contact);
    expect(actions.some((item) => item.key === 'object_created' && item.done)).toBe(true);
    expect(actions.some((item) => item.key === 'open_object_setup' && item.href?.includes('pilot_x'))).toBe(true);
    expect(actions.some((item) => item.key === 'open_channel_manager')).toBe(true);
    expect(actions.some((item) => item.key === 'open_ops')).toBe(true);
  });

  it('показывает создать объект если связи нет', () => {
    const actions = resolvePilotChainNextActions(baseContact({ status: 'onboarding' }));
    expect(actions[0]).toMatchObject({ key: 'create_object', done: false });
  });
});

describe('pilot-chain orchestrator', () => {
  beforeEach(() => {
    contacts.clear();
    crmEvents.length = 0;
    opsTasks.length = 0;
    pilotKnowledgeRows = [];
    contacts.set('contact-1', baseContact());
  });

  it('прогоняет сквозной контур без дублей при повторе', async () => {
    const first = await runPilotChainForContact('contact-1');
    expect(first.steps.find((step) => step.step === 'lead_to_object')?.outcome).toBe('created');
    expect(first.objectId).toBe('pilot_spb_test_abc123');

    const second = await runPilotChainForContact('contact-1');
    expect(second.steps.find((step) => step.step === 'lead_to_object')?.outcome).toBe('skipped');
    expect(pilotKnowledgeRows).toHaveLength(1);
  });
});

describe('pilot-chain onboarding block', () => {
  it('строит блок онбординга с href МК', () => {
    const readiness = computeObjectReadiness({ address: 'СПб', onboardingStatus: 'onboarding_started' });
    const block = buildOnboardingNoteBlock({
      objectId: 'pilot_test',
      contactId: 'c-1',
      onboardingStatus: 'missing_required_data',
      readiness,
      contact: baseContact(),
      channelManagerHref: '/dashboard/channel-connections?objectId=pilot_test',
    });
    expect(block).toContain('object_id=pilot_test');
    expect(block).toContain('Менеджер каналов:');
  });
});
