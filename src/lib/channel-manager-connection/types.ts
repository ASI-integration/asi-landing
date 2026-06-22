export const CHANNEL_MANAGER_CONNECTION_METHOD_VALUES = [
  'realtycalendar',
  'bnovo',
  'manual_import',
  'other',
  'none_yet',
] as const;

export type ChannelManagerConnectionMethod = (typeof CHANNEL_MANAGER_CONNECTION_METHOD_VALUES)[number];

export const CHANNEL_MANAGER_ACCESS_SITUATION_VALUES = [
  'has_access',
  'from_scratch',
  'needs_help',
] as const;

export type ChannelManagerAccessSituation = (typeof CHANNEL_MANAGER_ACCESS_SITUATION_VALUES)[number];

export const CHANNEL_MANAGER_CONNECTION_STATUS_VALUES = [
  'ready_to_connect',
  'waiting_access',
  'verifying_data',
  'prepared',
  'needs_operator',
  'connected',
  'primary_setup_needed',
] as const;

export type ChannelManagerConnectionStatus = (typeof CHANNEL_MANAGER_CONNECTION_STATUS_VALUES)[number];

export type ChannelManagerConnectionState = {
  objectId: string | null;
  contactId: string | null;
  method: ChannelManagerConnectionMethod | null;
  customManagerName: string | null;
  accessSituation: ChannelManagerAccessSituation | null;
  status: ChannelManagerConnectionStatus;
  nextStepRu: string;
  updatedAt: string | null;
};

export type ChannelManagerConnectionAction =
  | 'open_flow'
  | 'select_method'
  | 'select_access'
  | 'set_custom_name';
