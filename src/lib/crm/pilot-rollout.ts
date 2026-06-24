import type { CrmContact, CrmStatus, PilotRolloutStatus } from './types';
import {
  PILOT_ROLLOUT_STATUS_LABELS,
  PILOT_ROLLOUT_STATUS_VALUES,
} from './types';

export { PILOT_ROLLOUT_STATUS_LABELS, PILOT_ROLLOUT_STATUS_VALUES };
export type { PilotRolloutStatus };

export const PILOT_LIMIT_FULL_MESSAGE =
  'Лимит пилота заполнен. Нового участника можно добавить после паузы или завершения другого пилота.';

const LEGACY_TO_PILOT: Record<string, PilotRolloutStatus> = {
  new: 'new',
  new_lead: 'new',
  pilot_candidate: 'new',
  contact: 'new',
  qualified: 'new',
  needs_reaction: 'new',
  waitlist: 'waitlist',
  pilot_waitlist: 'waitlist',
  invited: 'invited',
  instruction_sent: 'invited',
  pilot_selected: 'invited',
  onboarding: 'onboarding',
  waiting_object_data: 'onboarding',
  needs_clarification: 'onboarding',
  access_received: 'onboarding',
  object_filled: 'onboarding',
  creating_object: 'onboarding',
  object_setup: 'onboarding',
  test_object_selected: 'onboarding',
  ready_for_test: 'onboarding',
  testing_communication: 'onboarding',
  active_pilot: 'active_pilot',
  pilot: 'active_pilot',
  pilot_active: 'active_pilot',
  paused: 'paused',
  rejected: 'rejected',
  not_relevant: 'rejected',
  not_fit: 'rejected',
};

const PILOT_TO_STORAGE: Record<PilotRolloutStatus, CrmStatus> = {
  new: 'new',
  waitlist: 'waitlist',
  invited: 'invited',
  onboarding: 'onboarding',
  active_pilot: 'active_pilot',
  paused: 'paused',
  rejected: 'rejected',
};

const STORAGE_ALIASES: Record<string, CrmStatus> = {
  new_lead: 'new',
  pilot_candidate: 'new',
  pilot_waitlist: 'waitlist',
  pilot_active: 'active_pilot',
  pilot: 'active_pilot',
  not_fit: 'rejected',
  not_relevant: 'rejected',
};

export type PilotRolloutMetrics = {
  activePilots: number;
  waitlist: number;
  onboarding: number;
  needsAttention: number;
  limit: number;
  limitReached: boolean;
};

export type PilotLimitCheck = {
  allowed: boolean;
  activeCount: number;
  limit: number;
  message?: string;
};

export function getPilotActiveLimit(): number {
  const raw = process.env.PILOT_ACTIVE_LIMIT;
  const parsed = raw ? Number.parseInt(raw, 10) : 4;
  if (!Number.isFinite(parsed) || parsed < 1) return 4;
  return parsed;
}

export function resolvePilotRolloutStatus(status: CrmStatus | string): PilotRolloutStatus {
  return LEGACY_TO_PILOT[status] ?? 'new';
}

export function pilotRolloutStatusLabel(status: CrmStatus | string): string {
  return PILOT_ROLLOUT_STATUS_LABELS[resolvePilotRolloutStatus(status)];
}

export function isActivePilotStatus(status: CrmStatus | string): boolean {
  return resolvePilotRolloutStatus(status) === 'active_pilot';
}

export function isPilotParticipantStatus(status: CrmStatus | string): boolean {
  const rollout = resolvePilotRolloutStatus(status);
  return rollout === 'onboarding' || rollout === 'active_pilot' || rollout === 'invited';
}

export function normalizePilotRolloutStorageStatus(status: CrmStatus | string): CrmStatus {
  const rollout = resolvePilotRolloutStatus(status);
  if (PILOT_ROLLOUT_STATUS_VALUES.includes(rollout)) {
    return PILOT_TO_STORAGE[rollout];
  }
  const alias = STORAGE_ALIASES[status as CrmStatus];
  return alias ?? (status as CrmStatus);
}

export function countActivePilots(contacts: CrmContact[]): number {
  return contacts.filter((contact) => !contact.crmArchived && isActivePilotStatus(contact.status)).length;
}

export function checkActivePilotLimit(
  contacts: CrmContact[],
  params: { targetContactId?: string; nextStatus?: PilotRolloutStatus | CrmStatus | string } = {},
): PilotLimitCheck {
  const limit = getPilotActiveLimit();
  const nextRollout = params.nextStatus ? resolvePilotRolloutStatus(params.nextStatus) : null;
  const activeCount = contacts.filter(
    (contact) =>
      !contact.crmArchived &&
      isActivePilotStatus(contact.status) &&
      contact.id !== params.targetContactId,
  ).length;

  if (nextRollout === 'active_pilot' && activeCount >= limit) {
    return {
      allowed: false,
      activeCount,
      limit,
      message: PILOT_LIMIT_FULL_MESSAGE,
    };
  }

  return { allowed: true, activeCount, limit };
}

export function computePilotRolloutMetrics(contacts: CrmContact[]): PilotRolloutMetrics {
  const visible = contacts.filter((contact) => !contact.crmArchived);
  const limit = getPilotActiveLimit();
  const activePilots = countActivePilots(visible);

  return {
    activePilots,
    waitlist: visible.filter((contact) => resolvePilotRolloutStatus(contact.status) === 'waitlist').length,
    onboarding: visible.filter((contact) => resolvePilotRolloutStatus(contact.status) === 'onboarding').length,
    needsAttention: visible.filter((contact) => contactNeedsPilotAttention(contact)).length,
    limit,
    limitReached: activePilots >= limit,
  };
}

export function contactNeedsPilotAttention(contact: CrmContact): boolean {
  if (contact.communicationStatus === 'needs_manual_reaction' || contact.communicationStatus === 'has_problem') {
    return true;
  }
  if (contact.onboarding?.status === 'needs_operator') return true;
  if (resolvePilotRolloutStatus(contact.status) === 'new' && contact.communicationStatus === 'waiting_reply') {
    return true;
  }
  return false;
}

export function validatePilotStatusChange(
  contacts: CrmContact[],
  contactId: string,
  nextStatus: CrmStatus,
): string | null {
  const check = checkActivePilotLimit(contacts, {
    targetContactId: contactId,
    nextStatus,
  });
  return check.allowed ? null : (check.message ?? PILOT_LIMIT_FULL_MESSAGE);
}
