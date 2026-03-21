// ─── Language ─────────────────────────────────────────────────────────────────

export type Lang = 'en' | 'ru';

// ─── Message Category ─────────────────────────────────────────────────────────

export enum MessageCategory {
  Start        = 'start',
  Greeting     = 'greeting',
  GuestMessage = 'guest-message',
  Issue        = 'issue',
  Booking      = 'booking',
  Fallback     = 'fallback',
}

// ─── Slot Signals ─────────────────────────────────────────────────────────────

export interface MessageSlots {
  isUrgent: boolean;
  isAccessRelated: boolean;
  mentionsGuest: boolean;
  mentionsTime: boolean;
  mentionsObject: boolean;
}

// ─── Classification Result ────────────────────────────────────────────────────

export interface ClassifyResult {
  category: MessageCategory;
  lang: Lang;
  slots: MessageSlots;
}

// ─── Telegram Update (minimal surface we actually use) ────────────────────────

export interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  from?: { language_code?: string };
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

// ─── Conversation Persistence ─────────────────────────────────────────────────

export interface ConversationSession {
  chat_id: number;
  created_at: string;
  updated_at: string;
  /** Reserved for future: matched guest/property IDs */
  guest_id?: string;
  property_id?: string;
}

export enum TurnRole {
  User      = 'user',
  Assistant = 'assistant',
}

export interface MessageTurn {
  chat_id: number;
  update_id?: number;
  role: TurnRole;
  /** Truncated at 2000 chars before storage to avoid storing huge blobs */
  content: string;
  category?: MessageCategory;
  lang?: Lang;
  created_at: string;
}

// ─── Audit Events ─────────────────────────────────────────────────────────────

export enum AuditEventType {
  InboundReceived   = 'INBOUND_RECEIVED',
  OutboundSent      = 'OUTBOUND_SENT',
  DuplicateDropped  = 'DUPLICATE_DROPPED',
  LLMCalled         = 'LLM_CALLED',
  LLMFallback       = 'LLM_FALLBACK',
  EscalationCreated = 'ESCALATION_CREATED',
  PersistError      = 'PERSIST_ERROR',
  UnhandledError    = 'UNHANDLED_ERROR',
}

export interface AuditEvent {
  type: AuditEventType;
  chat_id?: number;
  update_id?: number;
  /** Only set for inbound — truncated to 100 chars, no raw secrets */
  message_preview?: string;
  category?: MessageCategory;
  lang?: Lang;
  /** Freeform detail — must never contain secrets or full raw bodies */
  detail?: string;
  ts: string;
}

// ─── Escalation ───────────────────────────────────────────────────────────────

export enum EscalationReason {
  /** LLM was unable to produce a confident reply */
  LLMUncertain     = 'LLM_UNCERTAIN',
  /** Category explicitly requires human judgement */
  RequiresOperator = 'REQUIRES_OPERATOR',
  /** Unhandled error during processing */
  ProcessingError  = 'PROCESSING_ERROR',
  /** Urgent issue detected by slot signals */
  UrgentIssue      = 'URGENT_ISSUE',
}

export interface EscalationEvent {
  reason: EscalationReason;
  chat_id: number;
  update_id?: number;
  category?: MessageCategory;
  /** Short human-readable summary — no raw message body */
  summary: string;
  created_at: string;
}

// ─── Orchestration Result ─────────────────────────────────────────────────────

export enum ProcessOutcome {
  Replied   = 'replied',
  Duplicate = 'duplicate',
  Ignored   = 'ignored',
  Error     = 'error',
}

export interface ProcessResult {
  outcome: ProcessOutcome;
  update_id?: number;
  chat_id?: number;
  category?: MessageCategory;
  escalation?: EscalationEvent;
}
