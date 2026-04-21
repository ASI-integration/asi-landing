// ─── Conversation Domain Model ────────────────────────────────────────────────

export enum ConversationState {
  New              = 'new',
  Qualifying       = 'qualifying',
  AwaitingResponse = 'awaiting_response',
  Engaged          = 'engaged',
  NeedsOperator    = 'needs_operator',
  Converted        = 'converted',
  Dropped          = 'dropped',
}

export interface Conversation {
  id: string;
  channel: string;           // 'telegram' | 'whatsapp' | 'email'
  contactId: string;
  leadId?: string;
  reservationId?: string;
  propertyId?: string;
  status: 'active' | 'paused' | 'closed' | 'escalated';
  currentState: ConversationState;
  lastMessageAt: string;     // ISO
  createdAt: string;
  updatedAt: string;
}

export type ConversationSession = {
  sessionId: string;
  actorId?: string;
  role: 'guest' | 'lead' | 'operator' | 'owner' | 'unknown';
  propertyId?: string;
  reservationId?: string;
  leadId?: string;
  channel: string;

  state: 'active' | 'awaiting_input' | 'resolved' | 'escalated';

  memory: {
    lastMessages: Message[];
    extractedFacts: Record<string, any>;
    summary?: string;
  };

  confidence: number;
  resolutionStatus?: 'resolved' | 'ambiguous' | 'unresolved';
  updatedAt: string;
  createdAt: string;
};

// ─── Message Domain Model ────────────────────────────────────────────────────

export enum MessageDirection {
  Inbound  = 'inbound',
  Outbound = 'outbound',
}

export enum MessageType {
  Text    = 'text',
  Image   = 'image',
  Voice   = 'voice',
  System  = 'system',
}

export enum DeliveryStatus {
  Pending   = 'pending',
  Sent      = 'sent',
  Delivered = 'delivered',
  Failed    = 'failed',
}

export interface Message {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  type: MessageType;
  content: string;
  meta?: Record<string, unknown>;   // raw provider payload
  deliveryStatus: DeliveryStatus;
  providerMessageId?: string;
  createdAt: string;
}

// ─── Routing ──────────────────────────────────────────────────────────────────

export type RouteType = 'AUTO_REPLY' | 'SCENARIO' | 'ESCALATE' | 'ACTION';

export type ScenarioType =
  | 'pricing'
  | 'check_in'
  | 'check_out'
  | 'ops_emergency'
  | 'payment';

export interface RouteDecision {
  type: RouteType;
  scenario?: ScenarioType;
  /** Human-readable reason, useful for audit trail */
  reason: string;
  /** Confidence that the route is correct (0–1) */
  confidence: number;
}

// ─── Integration Events ───────────────────────────────────────────────────────

export type CommEventType =
  | 'conversation.started'
  | 'message.received'
  | 'message.sent'
  | 'conversation.escalated'
  | 'session.completed'
  | 'lead.created'
  | 'reservation.linked'
  | 'conversation.state_changed';

export interface CommEvent {
  type: CommEventType;
  conversationId?: string;
  chatId?: number;
  channel?: string;
  payload: Record<string, unknown>;
  ts: string;   // ISO
}

// ─── Delivery ─────────────────────────────────────────────────────────────────

export interface DeliveryResult {
  sent: boolean;
  attempts: number;
  providerMessageId?: string;
  error?: string;
}

// ─── Handoff Mode ─────────────────────────────────────────────────────────────

export type HandoffMode = 'AUTO' | 'ASSISTED' | 'MANUAL';

export interface PendingMessage {
  id: string;
  chatId: number;
  conversationId?: string;
  draftText: string;
  context: string;             // brief summary of why it was drafted
  status: 'pending' | 'approved' | 'rejected' | 'sent';
  createdAt: string;
  resolvedAt?: string;
}

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
  /** RU staff-group bridge: operator-provided booking reference (reservation_ref). */
  bookingReference?: string;
  /** RU staff-group bridge: operator-provided property clue (address / name / location). */
  propertyLocation?: string;
  /** RU staff-group bridge: operator-provided check-in date (YYYY-MM-DD). */
  checkInDate?: string;
  lastMessageAt: Date;
  incident?: boolean;
  incident_type?: string;
  severity?: string;
  escalation_candidate?: boolean;
  // Identity binding and role separation
  role?: Role;
  entityType?: 'reservation' | 'property' | 'lead' | 'unknown';
  entityId?: string;
  propertyId?: string;
  reservationId?: string;
  leadId?: string;
  identityConfidence?: number;
  identityResolutionStatus?: 'resolved' | 'ambiguous' | 'unresolved';
  /** Optional: human/audit-friendly explanation of how identity was resolved. */
  identityReason?: string;
}

// Role and identity resolution types
export type Role = 'guest' | 'lead' | 'operator' | 'owner' | 'unknown';

export interface IdentityResolution {
  role: Role;
  entityType: 'reservation' | 'property' | 'lead' | 'unknown';
  entityId?: string;
  propertyId?: string;
  reservationId?: string;
  leadId?: string;
  guestId?: string;
  confidence: number;
  status: 'resolved' | 'ambiguous' | 'unresolved';
  reason?: string;
  /** Ordered steps used to resolve identity (for audit/debug). */
  resolutionPath?: string[];
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

/** Telegram Voice object (voice note). */
export interface TelegramVoice {
  file_id:        string;
  file_unique_id: string;
  duration:       number;
  mime_type?:     string;
  file_size?:     number;
}

/** Telegram Audio object (music/audio file). */
export interface TelegramAudio {
  file_id:        string;
  file_unique_id: string;
  duration:       number;
  performer?:     string;
  title?:         string;
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
  /** Voice note. */
  voice?: TelegramVoice;
  /** Audio file. */
  audio?: TelegramAudio;
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
  type:      'photo' | 'document' | 'note' | 'voice' | 'audio';
  label:     string;
  file_id?:  string;
  /** Resolved download URL — only available if file is fetched via Bot API */
  url?:      string;
  caption?:  string;
  file_size?: number;
  duration?: number;
  transcript?: string;
}

// ─── Conversation Persistence ─────────────────────────────────────────────────

export interface TelegramConversationSessionRow {
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
  AutonomousDecision = 'AUTONOMOUS_DECISION',
  IdentityDecision  = 'IDENTITY_DECISION',
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
  /** Intent model confidence below autonomous threshold */
  LowIntentConfidence = 'LOW_INTENT_CONFIDENCE',
  /** Payment/refund/dispute-style message needing human review */
  PaymentComplaint = 'PAYMENT_COMPLAINT',
}

/** Per-chat autonomous pipeline session (see conversation-session-store). */
export type AutonomousSessionRole = 'guest' | 'staff' | 'unknown';

export enum AutonomousSessionStatus {
  Active                 = 'active',
  Collecting             = 'collecting',
  AwaitingClarification  = 'awaiting_clarification',
  Escalated              = 'escalated',
  /** All required info gathered; request has been fulfilled — stop asking. */
  Completed              = 'completed',
}

/** One message in the per-session short-term timeline (capped at 10 entries). */
export interface SessionTimelineEntry {
  role: 'user' | 'assistant';
  /** Truncated to 500 chars before storage. */
  text: string;
  ts: string; // ISO
}

export interface AutonomousConversationSession {
  chat_id: number;
  /** Channel this session was created on. Needed for outbound routing. */
  channel?: CommunicationChannel;
  role: AutonomousSessionRole;
  // Identity binding & role separation (best-effort; safe defaults when unknown)
  identity_role?: Role;
  entity_type?: 'reservation' | 'property' | 'lead' | 'unknown';
  entity_id?: string;
  property_id?: string;
  reservation_id?: string;
  lead_id?: string;
  identity_confidence?: number;
  identity_resolution_status?: 'resolved' | 'ambiguous' | 'unresolved';
  identity_reason?: string;
  intent?: IntentCategory;
  intent_confidence?: number;
  status: AutonomousSessionStatus;
  /** Normalised slots gathered across turns (booking ref, property clue, etc.) */
  collected_data: Record<string, string | undefined>;
  updated_at: string;
  /** Last 10 turns used for context-aware decision and escalation logic. */
  timeline: SessionTimelineEntry[];
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
  /**
   * Optional: included for RU Telegram verification / dry-run harnesses.
   * In production replies are still sent via the channel adapter.
   */
  reply?: string;
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

export type CommunicationChannel = 'telegram' | 'vk' | 'email' | 'phone' | 'max';

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
