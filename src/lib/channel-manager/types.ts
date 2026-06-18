export type ChannelCode =
  | 'yandex_travel'
  | 'ostrovok'
  | 'sutochno'
  | 'avito_travel'
  | 'one_zero_one_hotels'
  | 'bronevik_mts_travel'
  | 'cian_daily'
  | 'manual'
  | 'email_parsing'
  | 'ical'
  | 'mock';

export type IntegrationType =
  | 'api'
  | 'partner_channel_manager_api'
  | 'ical'
  | 'manual'
  | 'email_parsing'
  | 'mock';

export type SyncMode = 'disabled' | 'read_only' | 'shadow' | 'active';
export type ChannelStatus = 'planned' | 'mocked' | 'ready_for_credentials' | 'sandbox' | 'active' | 'disabled' | 'error';
export type ChannelAdapterKind = 'mock' | 'manual' | 'api';
export type ListingStatus = 'active' | 'disabled' | 'error';
export type ReservationStatus =
  | 'pending'
  | 'confirmed'
  | 'cancelled'
  | 'declined'
  | 'conflict'
  | 'rejected_by_inventory'
  | 'modified';
export type SyncJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type ShadowBookingEventType = 'reservation_created' | 'reservation_cancelled' | 'reservation_modified';
export type ShadowBookingEventStatus = 'processed' | 'duplicate' | 'conflict' | 'skipped';
export type ShadowDiscrepancyType =
  | 'external_availability_mismatch'
  | 'insufficient_availability'
  | 'reservation_not_found'
  | 'shadow_mode_required';
export type ShadowDiscrepancySeverity = 'info' | 'warning' | 'critical';
export type ChannelOperation =
  | 'availability_push'
  | 'rates_push'
  | 'restrictions_push'
  | 'dry_run_preview'
  | 'booking_pull'
  | 'booking_webhook'
  | 'cancellation_webhook'
  | 'modification_webhook';
export type ChannelRiskLevel = 'low' | 'medium' | 'high';

export interface ChannelCapability {
  code: ChannelCode;
  displayName: string;
  integrationType: IntegrationType;
  status: Exclude<ChannelStatus, 'error'>;
  notes: string;
  requiredCredentials: string[];
  supportedOperations: ChannelOperation[];
  riskLevel: ChannelRiskLevel;
  reliabilityLevel: number;
  commissionPercent: number;
}

export interface ChannelManagerChannel {
  id: string;
  accountId: string;
  code: ChannelCode;
  name: string;
  adapterKind: ChannelAdapterKind;
  status: ChannelStatus;
  integrationType: IntegrationType;
  syncMode: SyncMode;
  isEnabled: boolean;
  isAutoSellEnabled: boolean;
  isOverbookingProtectionEnabled: boolean;
  reliabilityLevel: number;
  commissionPercent: number;
  supportsAvailabilityPush: boolean;
  supportsRatesPush: boolean;
  supportsRestrictionsPush: boolean;
  supportsBookingPull: boolean;
  supportsBookingWebhook: boolean;
  supportsCancellationWebhook: boolean;
  supportsModificationWebhook: boolean;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelListing {
  id: string;
  accountId: string;
  channelId: string;
  propertyId: string;
  unitKey: string;
  externalListingId: string;
  title: string | null;
  status: ListingStatus;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryDay {
  id: string;
  accountId: string;
  propertyId: string;
  unitKey: string;
  day: string;
  totalUnits: number;
  bookedUnits: number;
  manualBlockedUnits: number;
  availableUnits: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelReservation {
  id: string;
  accountId: string;
  propertyId: string;
  unitKey: string;
  channelId: string | null;
  channelCode: ChannelCode;
  externalBookingId: string | null;
  idempotencyKey: string | null;
  guestName: string;
  checkInDate: string;
  checkOutDate: string;
  quantity: number;
  status: ReservationStatus;
  rejectionReason: string | null;
  priorityScore: number;
  totalAmount: number | null;
  commissionPercent: number | null;
  channelReliabilityLevel: number | null;
  guestType: string | null;
  receivedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelSyncJob {
  id: string;
  accountId: string;
  channelId: string;
  listingId: string | null;
  propertyId: string;
  unitKey: string;
  dateFrom: string;
  dateTo: string;
  reason: string;
  status: SyncJobStatus;
  syncMode: SyncMode;
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelSyncLog {
  id: string;
  accountId: string;
  jobId: string | null;
  channelId: string | null;
  listingId: string | null;
  direction: 'inbound' | 'outbound';
  status: 'ok' | 'error' | 'skipped';
  message: string | null;
  requestJson: Record<string, unknown>;
  responseJson: Record<string, unknown>;
  createdAt: string;
}

export interface ChannelShadowBookingEvent {
  id: string;
  accountId: string;
  channelId: string | null;
  listingId: string | null;
  propertyId: string;
  unitKey: string;
  eventType: ShadowBookingEventType;
  externalBookingId: string | null;
  idempotencyKey: string | null;
  guestName: string | null;
  checkInDate: string;
  checkOutDate: string;
  quantity: number;
  status: ShadowBookingEventStatus;
  available: boolean;
  reservationId: string | null;
  projectedAvailability: Record<string, number>;
  externalAvailability: Record<string, number>;
  createdAt: string;
}

export interface ChannelShadowDiscrepancy {
  id: string;
  accountId: string;
  shadowEventId: string;
  channelId: string | null;
  propertyId: string;
  unitKey: string;
  day: string | null;
  discrepancyType: ShadowDiscrepancyType;
  severity: ShadowDiscrepancySeverity;
  expectedValue: string | null;
  observedValue: string | null;
  message: string;
  createdAt: string;
}

export interface SetInventoryInput {
  propertyId: string;
  unitKey?: string;
  day: string;
  totalUnits: number;
  manualBlockedUnits: number;
}

export interface CreateChannelReservationInput {
  propertyId: string;
  unitKey?: string;
  channelCode?: ChannelCode;
  externalBookingId?: string;
  idempotencyKey?: string;
  guestName: string;
  checkInDate: string;
  checkOutDate: string;
  quantity?: number;
  totalAmount?: number;
  guestType?: string;
  confirmationMode?: 'confirm' | 'pending';
}

export interface CreateShadowBookingEventInput extends CreateChannelReservationInput {
  eventType?: ShadowBookingEventType;
  externalAvailabilityByDay?: Record<string, number>;
}

export interface ReservationCommandResult {
  reservationId: string;
  status: ReservationStatus;
  available: boolean;
  syncJobs: number;
  idempotent: boolean;
  priorityScore: number;
}

export interface CancelReservationResult {
  reservationId: string;
  status: ReservationStatus;
  syncJobs: number;
  idempotent: boolean;
}

export interface ModifyReservationDatesResult {
  reservationId: string;
  status: ReservationStatus;
  available: boolean;
  syncJobs: number;
}

export interface UpdateChannelInput {
  syncMode?: SyncMode;
  isEnabled?: boolean;
  isAutoSellEnabled?: boolean;
  isOverbookingProtectionEnabled?: boolean;
}
