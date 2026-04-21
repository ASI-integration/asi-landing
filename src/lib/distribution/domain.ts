export type DistributionChannelCode =
  | 'bookingcom'
  | 'expedia'
  | 'airbnb'
  | 'agoda'
  | 'tripcom'
  | (string & {});

export type ConnectionStatus = 'connected' | 'disabled' | 'error';

export type OtaAccountStatus = 'active' | 'disabled' | 'error';

export type SyncJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type SyncEventDirection = 'outbound' | 'inbound';
export type SyncEventStatus = 'ok' | 'error' | 'skipped';

export type SyncKind =
  | 'reservations_ingest'
  | 'availability_push'
  | 'rates_push'
  | 'restrictions_push'
  | 'full_resync'
  | (string & {});

export type DistributionChannel = {
  id: string;
  code: DistributionChannelCode;
  name: string;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
};

export type OTAAccount = {
  id: string;
  account_id: string;
  channel_id: string;
  nickname: string | null;
  status: OtaAccountStatus;
  external_id: string | null;
  config_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type PropertyChannelConnection = {
  id: string;
  account_id: string;
  property_id: string;
  channel_id: string;
  ota_account_id: string | null;
  status: ConnectionStatus;
  disabled_reason: string | null;
  last_success_at: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
  last_sync_state_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ChannelListing = {
  id: string;
  account_id: string;
  connection_id: string;
  internal_listing_key: string;
  external_listing_id: string;
  metadata_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type RatePlan = {
  id: string;
  account_id: string;
  connection_id: string;
  internal_rate_plan_key: string;
  external_rate_plan_id: string;
  currency: string | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type AvailabilityDay = {
  id: string;
  account_id: string;
  connection_id: string;
  listing_id: string | null;
  day: string; // YYYY-MM-DD
  available_units: number;
  closed: boolean;
  min_los: number | null;
  max_los: number | null;
  cutoff_days: number | null;
  updated_from: string;
  updated_at: string;
  created_at: string;
};

export type RateDay = {
  id: string;
  account_id: string;
  connection_id: string;
  listing_id: string | null;
  rate_plan_id: string | null;
  day: string; // YYYY-MM-DD
  base_rate: string | null; // numeric in db
  currency: string | null;
  updated_from: string;
  updated_at: string;
  created_at: string;
};

export type ChannelReservation = {
  id: string;
  account_id: string;
  connection_id: string;
  listing_id: string | null;
  external_reservation_id: string;
  status: 'new' | 'modified' | 'cancelled' | 'confirmed' | 'error';
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  check_in: string | null; // YYYY-MM-DD
  check_out: string | null; // YYYY-MM-DD
  currency: string | null;
  total_amount: string | null; // numeric in db
  raw_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type SyncJob = {
  id: string;
  account_id: string;
  connection_id: string;
  kind: SyncKind;
  requested_by: string;
  status: SyncJobStatus;
  idempotency_key: string | null;
  attempt_count: number;
  next_run_at: string | null;
  locked_at: string | null;
  lock_owner: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type SyncEvent = {
  id: string;
  account_id: string;
  connection_id: string;
  job_id: string | null;
  direction: SyncEventDirection;
  kind: SyncKind;
  request_json: Record<string, unknown>;
  response_json: Record<string, unknown>;
  status: SyncEventStatus;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
  created_at: string;
};

