export const CRM_ROLES = ['lead', 'owner', 'manager', 'guest', 'unknown'] as const;
export type CrmRole = (typeof CRM_ROLES)[number];

export const CRM_SOURCES = ['telegram', 'landing', 'manual', 'test'] as const;
export type CrmSource = (typeof CRM_SOURCES)[number];

export const CRM_STATUSES = [
  'new',
  'needs_clarification',
  'qualified',
  'creating_object',
  'object_filled',
  'testing_communication',
  'pilot_active',
  'paused',
  'not_fit',
] as const;
export type CrmStatus = (typeof CRM_STATUSES)[number];

export const CRM_EVENT_TYPES = [
  'escalation',
  'missing_data',
  'blocked',
  'auto_reply',
  'message_inbound',
  'message_outbound',
  'status_change',
  'note',
] as const;
export type CrmEventType = (typeof CRM_EVENT_TYPES)[number];

export type CrmFilter =
  | 'all'
  | 'new'
  | 'needs_reaction'
  | 'testing'
  | 'pilot_active'
  | 'escalations';

export type CrmContactRow = {
  id: string;
  name: string;
  role: string;
  source: string;
  contact: string | null;
  telegram_user_id: string | null;
  telegram_username: string | null;
  telegram_chat_id: string | null;
  status: string;
  property_id: string | null;
  property_count: number | null;
  notes: string;
  next_action: string;
  next_action_due_at: string | null;
  last_message: string | null;
  last_activity_at: string | null;
  lead_id: string | null;
  awaiting_reply: boolean;
  created_at: string;
  updated_at: string;
};

export type CrmEventRow = {
  id: string;
  contact_id: string;
  event_type: string;
  message_text: string | null;
  property_id: string | null;
  metadata: Record<string, unknown> | null;
  acknowledged_at: string | null;
  created_at: string;
};

export type CrmEventViewModel = {
  id: string;
  eventType: CrmEventType;
  messageText: string | null;
  propertyId: string | null;
  metadata: Record<string, unknown>;
  acknowledgedAt: string | null;
  createdAt: string;
  label: string;
};

export type CrmContactViewModel = {
  id: string;
  name: string;
  role: CrmRole;
  roleLabel: string;
  source: CrmSource;
  sourceLabel: string;
  contact: string | null;
  telegramUserId: string | null;
  telegramUsername: string | null;
  telegramChatId: string | null;
  telegramDisplay: string | null;
  status: CrmStatus;
  statusLabel: string;
  propertyId: string | null;
  propertyCount: number | null;
  notes: string;
  nextAction: string;
  nextActionDueAt: string | null;
  lastMessage: string | null;
  lastActivityAt: string | null;
  leadId: string | null;
  awaitingReply: boolean;
  escalationCount: number;
  unresolvedEscalationCount: number;
  needsReaction: boolean;
  needsReactionReasons: string[];
  createdAt: string;
  updatedAt: string;
  recentEvents: CrmEventViewModel[];
  missingDataFields: string[];
};

export type CreateCrmContactInput = {
  name: string;
  contact?: string | null;
  role: CrmRole;
  source?: CrmSource;
  status?: CrmStatus;
  notes?: string;
  nextAction?: string;
  nextActionDueAt?: string | null;
  propertyId?: string | null;
  propertyCount?: number | null;
  telegramUserId?: string | null;
  telegramUsername?: string | null;
  telegramChatId?: string | null;
};

export type UpdateCrmContactInput = {
  status?: CrmStatus;
  notes?: string;
  nextAction?: string;
  nextActionDueAt?: string | null;
  propertyId?: string | null;
  propertyCount?: number | null;
  awaitingReply?: boolean;
};

export type UpsertCrmFromTelegramInput = {
  name?: string | null;
  role: CrmRole;
  source?: CrmSource;
  telegramUserId: string;
  telegramUsername?: string | null;
  telegramChatId?: string | number | null;
  propertyId?: string | null;
  status?: CrmStatus;
  lastMessage?: string | null;
  leadId?: string | null;
  allowCreate?: boolean;
};

export type RecordCrmEventInput = {
  telegramUserId?: string | null;
  telegramChatId?: string | number | null;
  contactId?: string | null;
  eventType: CrmEventType;
  messageText?: string | null;
  propertyId?: string | null;
  metadata?: Record<string, unknown>;
  allowCreateContact?: boolean;
  contactHints?: Omit<UpsertCrmFromTelegramInput, 'lastMessage' | 'allowCreate'>;
};
