export type OperationPhaseId =
  | 'booking_intake'
  | 'guest_classification'
  | 'pre_arrival'
  | 'stay_support'
  | 'checkout'
  | 'review_follow_up';

export type OperationScenarioType =
  | 'new_booking'
  | 'guest_question'
  | 'maintenance_issue'
  | 'checkout'
  | 'review_request'
  | 'operator_escalation';

export type OperationStatus =
  | 'queued'
  | 'active'
  | 'waiting_guest'
  | 'waiting_partner'
  | 'needs_human'
  | 'completed';

export type OperationPriority = 'low' | 'normal' | 'high' | 'urgent';

export type OperationChannelId =
  | 'direct_site'
  | 'airbnb'
  | 'booking_com'
  | 'booking_ical'
  | 'ostrovok'
  | 'avito'
  | 'sutochno'
  | 'yandex_travel';

export type OperationAutomationStatus =
  | 'automated'
  | 'semi_automated'
  | 'manual_review';

export type OperationActor = 'asi' | 'guest' | 'operator' | 'partner' | 'system';

export type OperationSyncStatus =
  | 'draft'
  | 'ready'
  | 'queued'
  | 'syncing'
  | 'synced'
  | 'needs_attention'
  | 'blocked';

export type OperationTaskStatus =
  | 'queued'
  | 'assigned'
  | 'in_progress'
  | 'waiting_confirmation'
  | 'needs_human'
  | 'completed';

export type ListingMediaKind = 'photo' | 'floorplan' | 'document';

export type ListingMediaStatus = 'uploaded' | 'approved' | 'needs_caption' | 'excluded';

export type GuestCommunicationDirection = 'inbound' | 'outbound';

export type OperatorEscalationStatus = 'open' | 'resolved' | 'not_required';

export type OperationCommunicationEventType =
  | 'guest_question'
  | 'early_checkin_request'
  | 'late_checkout_request'
  | 'maintenance_issue'
  | 'cleaning_issue'
  | 'complaint'
  | 'checkout_support'
  | 'review_follow_up';

export type OperationEscalationReason =
  | 'urgent_maintenance'
  | 'guest_complaint'
  | 'cleaning_gap'
  | 'policy_exception'
  | 'low_confidence'
  | 'not_required';

export type OperationPhase = {
  id: OperationPhaseId;
  order: number;
  titleRu: string;
  goalRu: string;
  automationRoleRu: string;
  handoffTriggersRu: string[];
};

export type OperationNextAction = {
  owner: OperationActor;
  labelRu: string;
  dueRu: string;
  handoffRequired: boolean;
};

export type OperationTask = {
  id: string;
  titleRu: string;
  status: OperationStatus;
  automationStatus: OperationAutomationStatus;
};

export type OperationAuditEvent = {
  id: string;
  atRu: string;
  actor: OperationActor;
  titleRu: string;
  detailRu: string;
  status: OperationStatus;
};

export type ListingMediaAsset = {
  id: string;
  kind: ListingMediaKind;
  titleRu: string;
  url: string;
  altRu: string;
  status: ListingMediaStatus;
  distributionReady: boolean;
};

export type MaintenanceContact = {
  id: string;
  roleRu: string;
  nameRu: string;
  phoneRu: string;
  availabilityRu: string;
};

export type ListingIntakeDraftInput = {
  id?: string;
  ownerNameRu?: string;
  propertyNameRu?: string;
  cityRu?: string;
  addressRu?: string;
  propertyTypeRu?: string;
  capacityRu?: string;
  descriptionRu?: string;
  amenitiesRu?: string[];
  houseRulesRu?: string[];
  checkInInstructionsRu?: string[];
  checkOutInstructionsRu?: string[];
  accessInfoRu?: string[];
  cleaningRulesRu?: string[];
  maintenanceContact?: Partial<MaintenanceContact>;
  photoTitlesRu?: string[];
};

export type ListingIntakeValidationResult = {
  isValid: boolean;
  missingFieldsRu: string[];
};

export type InboundGuestMessage = {
  id: string;
  channelRu: string;
  channel?: string;
  conversationId?: string;
  guestNameRu: string;
  propertyListingId?: string;
  bookingOperationId?: string;
  reservationId?: string;
  textRu: string;
  receivedAtRu: string;
  metadata?: Record<string, unknown>;
};

export type OperationsMessageClassification = {
  eventType: OperationCommunicationEventType;
  confidence: number;
  priority: OperationPriority;
  phaseId: OperationPhaseId;
  automationStatus: OperationAutomationStatus;
  escalationReason: OperationEscalationReason;
  reasonRu: string;
};

export type ChannelListingMetadata = {
  channelId: OperationChannelId;
  externalListingId?: string;
  titleRu: string;
  commissionRu: string;
  minStayNights: number;
  instantBookEnabled: boolean;
};

export type ChannelManagerDistributionTarget = {
  id: string;
  channelId: OperationChannelId;
  channelNameRu: string;
  syncStatus: OperationSyncStatus;
  connected: boolean;
  lastSyncRu?: string;
  nextActionRu: string;
  syncedFieldsRu: string[];
  pendingFieldsRu: string[];
};

export type PropertyListingIntake = {
  id: string;
  ownerNameRu: string;
  propertyNameRu: string;
  cityRu: string;
  addressRu: string;
  propertyTypeRu: string;
  capacityRu: string;
  descriptionRu: string;
  amenitiesRu: string[];
  houseRulesRu: string[];
  checkInInstructionsRu: string[];
  checkOutInstructionsRu: string[];
  accessInfoRu: string[];
  cleaningRulesRu: string[];
  maintenanceContacts: MaintenanceContact[];
  media: ListingMediaAsset[];
  channelMetadata: ChannelListingMetadata[];
  distributionTargets: ChannelManagerDistributionTarget[];
  intakeStatus: OperationSyncStatus;
  auditEvents: OperationAuditEvent[];
};

export type ChannelDistributionPackageTarget = {
  channelId: OperationChannelId;
  channelNameRu: string;
  syncStatus: OperationSyncStatus;
  canQueueSync: boolean;
  payloadFieldsRu: string[];
  missingFieldsRu: string[];
};

export type ChannelDistributionPackage = {
  listingId: string;
  propertyNameRu: string;
  cityRu: string;
  ready: boolean;
  statusRu: string;
  targets: ChannelDistributionPackageTarget[];
};

export type CleaningTask = {
  id: string;
  operationId: string;
  propertyListingId: string;
  titleRu: string;
  assignedToRu: string;
  scheduledForRu: string;
  status: OperationTaskStatus;
  checklistRu: string[];
  notesRu: string;
};

export type MaintenanceTask = {
  id: string;
  operationId: string;
  propertyListingId: string;
  titleRu: string;
  assignedToRu: string;
  scheduledForRu: string;
  priority: OperationPriority;
  status: OperationTaskStatus;
  issueRu: string;
  handoffRequired: boolean;
};

export type GuestCommunicationEvent = {
  id: string;
  operationId: string;
  atRu: string;
  channelRu: string;
  direction: GuestCommunicationDirection;
  actor: OperationActor;
  intentRu: string;
  messageRu: string;
  automated: boolean;
  status: OperationStatus;
};

export type OperatorEscalation = {
  id: string;
  operationId: string;
  status: OperatorEscalationStatus;
  reasonRu: string;
  assignedToRu?: string;
  createdAtRu: string;
  decisionNeededRu: string;
  resolutionRu?: string;
};

export type BookingOperation = {
  id: string;
  scenarioId: string;
  propertyListingId: string;
  bookingCode: string;
  sourceChannelId: OperationChannelId;
  sourceChannelRu: string;
  guestNameRu: string;
  guestTypeRu: string;
  requestClassRu: string;
  checkInRu: string;
  checkOutRu: string;
  guestsCount: number;
  phaseId: OperationPhaseId;
  status: OperationStatus;
  nextAction: OperationNextAction;
  cleaningTaskIds: string[];
  maintenanceTaskIds: string[];
  communicationEventIds: string[];
  auditEventIds: string[];
  operatorEscalationId?: string;
};

export type DerivedBookingOperationTasks = {
  scenarioId: string;
  bookingOperationId: string | null;
  guestCommunicationRequired: boolean;
  cleaningTaskRequired: boolean;
  maintenanceTaskRequired: boolean;
  reviewRequestRequired: boolean;
  operatorEscalationRequired: boolean;
  taskLabelsRu: string[];
};

export type OperationsBridgeResult = {
  inboundMessage: InboundGuestMessage;
  classification: OperationsMessageClassification;
  guestCommunicationEvent: GuestCommunicationEvent;
  auditEvent: OperationAuditEvent;
  cleaningTask?: CleaningTask;
  maintenanceTask?: MaintenanceTask;
  operatorEscalation?: OperatorEscalation;
  reviewFollowUpActionRu?: string;
  createdActionLabelsRu: string[];
  operatorNeeded: boolean;
};

export type OperationScenario = {
  id: string;
  type: OperationScenarioType;
  nameRu: string;
  bookingOperationId?: string;
  propertyNameRu: string;
  guestNameRu: string;
  phaseId: OperationPhaseId;
  status: OperationStatus;
  priority: OperationPriority;
  automationStatus: OperationAutomationStatus;
  channelRu: string;
  summaryRu: string;
  nextAction: OperationNextAction;
  tasks: OperationTask[];
  events: OperationAuditEvent[];
};
