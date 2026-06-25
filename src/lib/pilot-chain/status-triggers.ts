import { resolvePilotRolloutStatus } from '@/lib/crm/pilot-rollout';
import type { CrmStatus } from '@/lib/crm/types';

const LEGACY_OBJECT_SETUP_STATUSES = new Set<CrmStatus>([
  'waiting_object_data',
  'access_received',
  'test_object_selected',
  'object_setup',
  'ready_for_test',
]);

export function shouldAutoProvisionObjectFromLead(status: CrmStatus | string): boolean {
  const rollout = resolvePilotRolloutStatus(status);
  if (rollout === 'onboarding' || rollout === 'active_pilot') return true;
  return LEGACY_OBJECT_SETUP_STATUSES.has(status as CrmStatus);
}
