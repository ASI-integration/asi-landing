export const onboardingSteps = ['business', 'owner', 'properties', 'units', 'operations', 'channel_manager', 'reservations', 'communications', 'legal_payments', 'staff', 'verification', 'launch'] as const;
export type OnboardingStep = typeof onboardingSteps[number];

export type LaunchStatus = 'draft' | 'collecting_data' | 'needs_verification' | 'blocked' | 'ready_for_pilot' | 'pilot_active' | 'degraded';
export type ChannelLaunchStatus = 'configuration_required' | 'credentials_required' | 'validating' | 'connected' | 'initial_sync' | 'synchronized' | 'degraded' | 'disconnected' | 'blocked';
export type StaffRole = 'cleaner' | 'linen_worker' | 'inspector' | 'maintenance_technician' | 'operator' | 'owner';

export type PropertyDraft = { key: string; name?: string; address?: string; timezone?: string };
export type UnitDraft = { key: string; propertyKey: string; name?: string; capacity?: number };
export type StaffDraft = { key: string; name?: string; role?: StaffRole; preferredChannel?: 'phone' | 'telegram' | 'email'; contact?: string; propertyKeys?: string[]; schedule?: string; notifications?: string };
export type VerificationItem = { key: string; propertyKey: string; status: 'pending' | 'passed' | 'issue'; blocking?: boolean; notes?: string; photoMetadata?: Record<string, unknown>[]; maintenanceTaskId?: string; reinspectionRequired?: boolean };

export type OnboardingData = {
  business?: { name?: string; legalName?: string };
  owner?: { name?: string; phone?: string; email?: string };
  properties?: PropertyDraft[];
  units?: UnitDraft[];
  operations?: { checkInTime?: string; checkOutTime?: string; cleaningRule?: string; linenRule?: string; inspectionRule?: string; maintenanceRule?: string };
  channelManager?: { provider?: string; credentialsRef?: string; snapshotReady?: boolean; status?: ChannelLaunchStatus };
  reservations?: { choice?: 'channel_manager' | 'csv' | 'manual' | 'skip'; completed?: boolean; skippedAt?: string; criticalConflicts?: number; mappingsComplete?: boolean; ledgerInitialized?: boolean; directIntakeReady?: boolean };
  communications?: { guestChannel?: string; workerChannel?: string; scopedPilotSendingEnabled?: boolean };
  legalPayments?: { legalMode?: string; depositMode?: string; mvdMode?: string };
  staff?: StaffDraft[];
  verification?: VerificationItem[];
};

export type ModuleKey = 'owner_setup' | 'property_setup' | 'object_readiness' | 'channel_manager' | 'channel_publication' | 'pricing' | 'availability' | 'booking_intake' | 'lifecycle_v16' | 'communication_policies' | 'sla_alerts' | 'checkin_checkout' | 'worker_roles' | 'task_templates';
export type ModuleState = { key: ModuleKey; status: 'pending' | 'initialized' | 'blocked'; idempotencyKey: string; detail?: string };
export type LaunchReadiness = { status: LaunchStatus; percentage: number; blockingItems: string[]; warnings: string[]; initializedModules: ModuleKey[]; connectedIntegrations: string[]; propertiesReady: number; propertiesTotal: number; staffReady: number; staffTotal: number; communicationReady: boolean; bookingIntakeReady: boolean; channelManagerReady: boolean; nextAction: string };

export interface ChannelManagerLiveAdapter {
  readonly provider: string;
  validateConnection(credentialsRef: string): Promise<{ ok: boolean; status: ChannelLaunchStatus; message?: string }>;
  importObjects(checkpoint?: string): Promise<AdapterBatch>;
  importUnits(checkpoint?: string): Promise<AdapterBatch>;
  importBookings(checkpoint?: string): Promise<AdapterBatch>;
  importCalendar(checkpoint?: string): Promise<AdapterBatch>;
  importPricing(checkpoint?: string): Promise<AdapterBatch>;
  incrementalSync(checkpoint?: string): Promise<AdapterBatch>;
  ingestWebhook?(event: unknown, idempotencyKey: string): Promise<{ accepted: boolean }>;
  health(): Promise<{ status: ChannelLaunchStatus; checkedAt: string; message?: string }>;
  upsertReservation(record: unknown, idempotencyKey: string): Promise<{ reservationId: string; created: boolean }>;
  cancelReservation(externalReservationId: string, idempotencyKey: string): Promise<{ changed: boolean }>;
  importReservations(checkpoint?: string): Promise<AdapterBatch>;
  importAvailabilityBlocks(checkpoint?: string): Promise<AdapterBatch>;
  reconcileReservation(externalReservationId: string): Promise<{ status: string; reservationId?: string }>;
  readSyncCheckpoint(stream: string): Promise<string | undefined>;
  saveSyncCheckpoint(stream: string, checkpoint: string, idempotencyKey: string): Promise<void>;
}
export type AdapterBatch = { records: unknown[]; checkpoint: string; idempotencyKey: string; conflicts?: { key: string; reason: string }[]; retryAfterMs?: number };
