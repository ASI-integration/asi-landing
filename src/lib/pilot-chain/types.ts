import type { CrmContact } from '@/lib/crm/types';

export type PilotChainAuditEvent =
  | 'lead_to_object_created'
  | 'object_to_channel_manager_prepared'
  | 'ops_case_created'
  | 'skipped_existing_object'
  | 'skipped_existing_ops';

export type PilotChainStepResult = {
  step: 'lead_to_object' | 'object_to_channel_manager' | 'channel_manager_to_ops';
  outcome: 'created' | 'updated' | 'skipped' | 'not_applicable';
  auditEvent?: PilotChainAuditEvent;
  objectId?: string | null;
  opsTaskId?: string | null;
};

export type PilotChainResult = {
  contactId: string;
  objectId: string | null;
  steps: PilotChainStepResult[];
  contact: CrmContact | null;
  opsTaskId: string | null;
};

export type PilotChainNextActionKey =
  | 'create_object'
  | 'object_created'
  | 'open_object_setup'
  | 'open_channel_manager'
  | 'open_ops';

export type PilotChainNextAction = {
  key: PilotChainNextActionKey;
  labelRu: string;
  href: string | null;
  done: boolean;
};
