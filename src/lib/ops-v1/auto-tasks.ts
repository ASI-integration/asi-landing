import { listCrmContacts } from '@/lib/crm/repository';
import type { CrmContact, CrmStatus } from '@/lib/crm/types';
import { listEscalationReviews } from '@/lib/communication/operator-review';
import { buildAutoOpsDedupKey, createOpsOperatorTask } from '@/lib/ops-board/repository';
import { OPS_TASK_TYPE_LABELS, type OpsTaskType } from '@/lib/ops-board/types';
import { supabase } from '@/lib/supabase';

const CRM_ONBOARDING_REVIEW_STATUSES: CrmStatus[] = [
  'access_received',
  'test_object_selected',
  'object_setup',
];

const CRM_MANUAL_REACTION_STATUSES = new Set(['needs_manual_reaction', 'has_problem']);

type AutoTaskSeed = {
  dedupKey: string;
  taskType: OpsTaskType;
  taskStatus: 'new' | 'needs_operator';
  source: 'crm' | 'channel_manager' | 'communication_autopilot';
  integration: string;
  sourceId: string;
  contactId?: string | null;
  objectId?: string | null;
  objectLabel?: string | null;
  ownerName?: string | null;
  guestName?: string | null;
  description: string;
  scheduledAt?: string | null;
  metadata?: Record<string, unknown>;
};

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysFromToday(iso: string | null | undefined, today: Date): number | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  const diffMs = startOfLocalDay(parsed).getTime() - startOfLocalDay(today).getTime();
  return Math.round(diffMs / (24 * 60 * 60 * 1000));
}

async function upsertAutoTask(seed: AutoTaskSeed): Promise<boolean> {
  const result = await createOpsOperatorTask({
    taskType: seed.taskType,
    taskStatus: seed.taskStatus,
    source: seed.source,
    title: OPS_TASK_TYPE_LABELS[seed.taskType],
    description: seed.description,
    contactId: seed.contactId ?? null,
    objectId: seed.objectId ?? null,
    objectLabel: seed.objectLabel ?? null,
    ownerName: seed.ownerName ?? null,
    guestName: seed.guestName ?? null,
    lastEventText: seed.description,
    dedupKey: seed.dedupKey,
    metadata: {
      created_by_system: true,
      source_id: seed.sourceId,
      integration: seed.integration,
      ...(seed.scheduledAt ? { scheduledAt: seed.scheduledAt } : {}),
      ...seed.metadata,
    },
    updateIfExists: {
      description: seed.description,
      lastEventText: seed.description,
    },
  });

  return result.ok && result.created;
}

function collectCrmOnboardingSeeds(contacts: CrmContact[]): AutoTaskSeed[] {
  const seeds: AutoTaskSeed[] = [];

  for (const contact of contacts) {
    if (contact.crmArchived) continue;
    if (!CRM_ONBOARDING_REVIEW_STATUSES.includes(contact.status)) continue;

    const objectId = contact.ownerObjects?.[0]?.objectId ?? null;
    const objectLabel = contact.activeObjectTitle ?? contact.ownerObjects?.[0]?.title ?? contact.name;

    seeds.push({
      dedupKey: buildAutoOpsDedupKey({
        source: 'crm',
        sourceId: contact.id,
        taskType: 'other',
      }),
      taskType: 'other',
      taskStatus: 'new',
      source: 'crm',
      integration: 'crm_onboarding',
      sourceId: contact.id,
      contactId: contact.id,
      objectId,
      objectLabel,
      ownerName: contact.name,
      description: 'Проверить готовность объекта к настройке',
    });
  }

  return seeds;
}

function collectObjectPassportSeeds(contacts: CrmContact[]): AutoTaskSeed[] {
  const seeds: AutoTaskSeed[] = [];

  for (const contact of contacts) {
    if (contact.crmArchived) continue;

    const missing = contact.onboarding?.missing ?? [];
    if (missing.length === 0) continue;

    const objectId = contact.ownerObjects?.[0]?.objectId ?? null;
    const objectLabel = contact.activeObjectTitle ?? contact.ownerObjects?.[0]?.title ?? contact.name;
    const missingLabels = missing.map((field) => String(field));

    seeds.push({
      dedupKey: buildAutoOpsDedupKey({
        source: 'object_passport',
        sourceId: contact.id,
        taskType: 'request_owner_data',
      }),
      taskType: 'request_owner_data',
      taskStatus: 'needs_operator',
      source: 'channel_manager',
      integration: 'object_passport',
      sourceId: contact.id,
      contactId: contact.id,
      objectId,
      objectLabel,
      ownerName: contact.name,
      description: 'Не хватает данных для публикации объекта',
      metadata: {
        missing_fields: missing,
        missing_labels: missingLabels,
      },
    });
  }

  return seeds;
}

function collectCommunicationSeeds(contacts: CrmContact[]): AutoTaskSeed[] {
  const seeds: AutoTaskSeed[] = [];

  for (const contact of contacts) {
    if (contact.crmArchived) continue;
    if (!CRM_MANUAL_REACTION_STATUSES.has(contact.communicationStatus)) continue;

    const objectId = contact.ownerObjects?.[0]?.objectId ?? null;
    const objectLabel = contact.activeObjectTitle ?? contact.ownerObjects?.[0]?.title ?? contact.name;

    seeds.push({
      dedupKey: buildAutoOpsDedupKey({
        source: 'communications',
        sourceId: `crm:${contact.id}`,
        taskType: 'verify_guest_issue',
      }),
      taskType: 'verify_guest_issue',
      taskStatus: 'needs_operator',
      source: 'communication_autopilot',
      integration: 'communications_escalation',
      sourceId: contact.id,
      contactId: contact.id,
      objectId,
      objectLabel,
      ownerName: contact.name,
      description: 'Требуется ручная проверка сообщения гостя',
    });
  }

  const reviews = listEscalationReviews({ status: 'pending', limit: 100 });
  for (const review of reviews) {
    const latestMessage = review.latestMessages.at(-1)?.content ?? review.detail ?? '';
    seeds.push({
      dedupKey: buildAutoOpsDedupKey({
        source: 'communications',
        sourceId: review.reviewId,
        taskType: 'verify_guest_issue',
      }),
      taskType: 'verify_guest_issue',
      taskStatus: 'needs_operator',
      source: 'communication_autopilot',
      integration: 'communications_escalation',
      sourceId: review.reviewId,
      contactId: review.leadId ?? null,
      objectId: review.propertyId ?? null,
      guestName: 'Гость',
      description: 'Требуется ручная проверка сообщения гостя',
      metadata: {
        escalation_reason: review.escalationReason,
        session_id: review.sessionId,
        latest_message: latestMessage.slice(0, 200),
      },
    });
  }

  return seeds;
}

type ReservationRow = {
  id: string;
  property_id: string | null;
  check_in: string | null;
  check_out: string | null;
  status: string | null;
};

async function collectBookingSeeds(today: Date): Promise<AutoTaskSeed[]> {
  // Booking autopilot hooks into tg_guest_reservations when the table is available.
  const { data, error } = await supabase
    .from('tg_guest_reservations')
    .select('id, property_id, check_in, check_out, status')
    .neq('status', 'cancelled')
    .limit(500);

  if (error || !data) {
    return [];
  }

  const seeds: AutoTaskSeed[] = [];

  for (const row of data as ReservationRow[]) {
    const propertyId = row.property_id?.trim() || null;
    if (!propertyId) continue;

    const checkinOffset = daysFromToday(row.check_in, today);
    if (checkinOffset === 0 || checkinOffset === 1) {
      const dateKey = localDateKey(new Date(row.check_in!));
      seeds.push({
        dedupKey: buildAutoOpsDedupKey({
          source: 'booking',
          sourceId: row.id,
          taskType: 'prepare_checkin',
          dateKey,
        }),
        taskType: 'prepare_checkin',
        taskStatus: 'new',
        source: 'crm',
        integration: 'booking',
        sourceId: row.id,
        objectId: propertyId,
        objectLabel: propertyId,
        description: checkinOffset === 0 ? 'Заезд сегодня' : 'Заезд завтра',
        scheduledAt: row.check_in,
      });
    }

    const checkoutOffset = daysFromToday(row.check_out, today);
    if (checkoutOffset === 0 || checkoutOffset === 1) {
      const dateKey = localDateKey(new Date(row.check_out!));
      seeds.push({
        dedupKey: buildAutoOpsDedupKey({
          source: 'booking',
          sourceId: row.id,
          taskType: 'prepare_checkout',
          dateKey,
        }),
        taskType: 'prepare_checkout',
        taskStatus: 'new',
        source: 'crm',
        integration: 'booking',
        sourceId: row.id,
        objectId: propertyId,
        objectLabel: propertyId,
        description: checkoutOffset === 0 ? 'Выезд сегодня' : 'Выезд завтра',
        scheduledAt: row.check_out,
      });
    }

    if (checkoutOffset === -1) {
      const dateKey = localDateKey(today);
      seeds.push({
        dedupKey: buildAutoOpsDedupKey({
          source: 'booking',
          sourceId: row.id,
          taskType: 'verify_cleaning',
          dateKey,
        }),
        taskType: 'verify_cleaning',
        taskStatus: 'new',
        source: 'crm',
        integration: 'booking',
        sourceId: row.id,
        objectId: propertyId,
        objectLabel: propertyId,
        description: 'Уборка после выезда',
        scheduledAt: row.check_out,
      });
    }
  }

  return seeds;
}

export async function syncAutoOpsTasks(): Promise<{ created: number; scanned: number }> {
  const contacts = await listCrmContacts({ excludeArchived: true });
  const today = new Date();

  const seeds = [
    ...collectCrmOnboardingSeeds(contacts),
    ...collectObjectPassportSeeds(contacts),
    ...collectCommunicationSeeds(contacts),
    ...(await collectBookingSeeds(today)),
  ];

  let created = 0;
  for (const seed of seeds) {
    const wasCreated = await upsertAutoTask(seed);
    if (wasCreated) created += 1;
  }

  return { created, scanned: seeds.length };
}
