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

export const CHANNEL_MANAGER_ROUTE_VALUES = ['has_manager', 'no_manager', 'unknown'] as const;

export type ChannelManagerRoute = (typeof CHANNEL_MANAGER_ROUTE_VALUES)[number];

export const CHANNEL_MANAGER_OBJECT_IN_MANAGER_VALUES = ['yes', 'no', 'unknown'] as const;

export type ChannelManagerObjectInManager = (typeof CHANNEL_MANAGER_OBJECT_IN_MANAGER_VALUES)[number];

export const MK_AUTOMATION_CONNECTION_STATUS_VALUES = [
  'needs_manager_check',
  'needs_manager_selection',
  'needs_object_preparation',
  'needs_access_confirmation',
  'ready_for_operator_review',
  'waiting_for_owner',
  'done',
] as const;

export type MkAutomationConnectionStatus = (typeof MK_AUTOMATION_CONNECTION_STATUS_VALUES)[number];

export const MK_RESPONSIBLE_ROLE_VALUES = [
  'owner',
  'manager',
  'administrator',
  'staff',
  'unknown',
  'asi_help',
] as const;

export type MkResponsibleRole = (typeof MK_RESPONSIBLE_ROLE_VALUES)[number];

export type ChannelManagerConnectionState = {
  objectId: string | null;
  contactId: string | null;
  method: ChannelManagerConnectionMethod | null;
  customManagerName: string | null;
  accessSituation: ChannelManagerAccessSituation | null;
  status: ChannelManagerConnectionStatus;
  nextStepRu: string;
  selectedChannelManager?: string | null;
  channelManagerRoute?: ChannelManagerRoute | null;
  objectInChannelManager?: ChannelManagerObjectInManager | null;
  targetPlacementChannels?: string[];
  connectionStatus?: MkAutomationConnectionStatus | null;
  mkResponsibleRole?: MkResponsibleRole | null;
  mkResponsibleContact?: string | null;
  mkResponsibleName?: string | null;
  nextOperatorAction?: string | null;
  nextOwnerMessage?: string | null;
  updatedAt: string | null;
};

export type ChannelManagerConnectionAction =
  | 'open_flow'
  | 'select_method'
  | 'select_access'
  | 'set_custom_name';
