// ─── Language ─────────────────────────────────────────────────────────────────

export type Lang = 'zh' | 'en' | 'es' | 'ar' | 'fr' | 'de' | 'ru';

// ─── Message Category ─────────────────────────────────────────────────────────

export enum MessageCategory {
  Start        = 'start',
  Greeting     = 'greeting',
  GuestMessage = 'guest-message',
  Issue        = 'issue',
  Booking      = 'booking',
  Fallback     = 'fallback',
}

// ─── Intent & Memory (Phase 1) ──────────────────────────────────────────────────

export enum IntentCategory {
  BookingInquiry  = 'booking_inquiry',
  CheckInInfo     = 'check_in_info',
  CheckOut        = 'check_out',
  IssueReport     = 'issue_report',
  PaymentRequest  = 'payment_request',
  UpsellRequest   = 'upsell_request',
  GeneralQuestion = 'general_question',
  Unknown         = 'unknown',
}

export interface IntentResult {
  intent: IntentCategory;
  confidence: number;
}

export interface ConversationContext {
  lastIntent?: IntentCategory;
  guestName?: string;
  reservationId?: string;
  lastMessageAt: Date;
  incident?: boolean;
  incident_type?: string;
  severity?: string;
  escalation_candidate?: boolean;
}

// ─── Payment Stub ─────────────────────────────────────────────────────────────

export interface PaymentRequest {
  id: string;
  chatId: number;
  amount: number;
  currency: string;
  status: 'pending' | 'paid' | 'failed';
  description?: string;
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

/** A single Telegram PhotoSize object (smallest usable subset). */
export interface TelegramPhotoSize {
  file_id:        string;
  file_unique_id: string;
  width:          number;
  height:         number;
  file_size?:     number;
}

/** A Telegram Document (file) object. */
export interface TelegramDocument {
  file_id:        string;
  file_unique_id: string;
  file_name?:     string;
  mime_type?:     string;
  file_size?:     number;
}

export interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  from?: { language_code?: string };
  text?: string;
  /** Array of photo sizes — Telegram always sends smallest → largest. */
  photo?: TelegramPhotoSize[];
  /** Generic document / file attachment. */
  document?: TelegramDocument;
  /** Caption for photo/document messages. */
  caption?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

/**
 * Normalised attachment descriptor stored in ops_tasks.attachment_refs
 * and displayed in the operator leads page.
 */
export interface TelegramAttachmentRef {
  type:      'photo' | 'document' | 'note';
  label:     string;
  file_id?:  string;
  /** Resolved download URL — only available if file is fetched via Bot API */
  url?:      string;
  caption?:  string;
  file_size?: number;
}

// ─── Conversation Persistence ─────────────────────────────────────────────────

export interface ConversationSession {
  chat_id: number;
  created_at: string;
  updated_at: string;
  /** Operational session status — see SessionStatus in session-status.ts */
  status?: string;
  status_updated_at?: string;
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

// ─── Phase 2 ──────────────────────────────────────────────────────────────────

export interface ReservationMatchResult {
  status: 'matched' | 'ambiguous' | 'unmatched';
  reservationId?: string;
  propertyId?: string;
  listingId?: string;
  guestId?: string;
  guestName?: string;
  confidence: number;
  candidates?: Array<{
    reservationId: string;
    guestName?: string;
    checkIn?: string;
    checkOut?: string;
  }>;
}

export interface GroundedKnowledge {
  universalPolicy: string;
  propertyPolicy?: string;
  houseRules?: string;
  checkInInstructions?: string;
  checkOutInstructions?: string;
  wifiInstructions?: string;
  parkingInstructions?: string;
  paymentRules?: string;
  upsells?: string;
  emergencyContacts?: string;
}

export interface CommunicationContext {
  chatId: number;
  memory: ConversationContext;
  intentResult: { intent: IntentCategory; confidence: number };
  reservation: ReservationMatchResult;
  knowledge: GroundedKnowledge;
  recentMessages: MessageTurn[];
}

export type IssuePriority = 'emergency' | 'urgent' | 'normal' | 'informational';

export type ActionType =
  | 'send_informational_reply'
  | 'ask_clarifying_question'
  | 'escalate_to_operator'
  | 'create_issue_record'
  | 'create_service_request'
  | 'trigger_payment_request'
  | 'provide_check_in_instructions'
  | 'provide_checkout_instructions';

export interface ActionSafetyResult {
  safe: boolean;
  action: ActionType;
  reason?: string;
  escalationReason?: EscalationReason;
}

export interface OperatorHandoffPayload {
  guestSummary: string;
  detectedIntent: string;
  reservationStatus: string;
  issuePriority: IssuePriority;
  lastMessagesSummary: string;
  recommendedAction: string;
  reasonForEscalation: string;
}

// ─── Phase 3: Multi-Channel & Multilingual ────────────────────────────────────

export type CommunicationChannel = 'telegram' | 'email' | 'phone' | 'max';

export interface InboundMessageEnvelope {
  channel: CommunicationChannel;
  externalUserId: string;
  chatId?: string;
  phoneNumber?: string;
  email?: string;
  messageText?: string;
  subject?: string;
  metadata?: Record<string, unknown>;
  receivedAt: Date;
  /** Caller-supplied idempotency key (e.g. Telegram update_id). Falls back to Date.now(). */
  update_id?: number;
}

export type PhoneCallRecord = {
  id: string;
  phoneNumber: string;
  reservationId?: string;
  propertyId?: string;
  guestId?: string;
  startedAt: Date;
  endedAt?: Date;
  direction: 'inbound' | 'outbound';
  status: 'missed' | 'answered' | 'voicemail' | 'escalated';
  summary?: string;
};

export type LanguageCode = 'zh' | 'en' | 'es' | 'ar' | 'fr' | 'de' | 'ru';

export interface LanguageResolution {
  detectedLanguage: LanguageCode;
  confidence: number;
  source: 'message' | 'profile' | 'manual_override' | 'fallback';
}
