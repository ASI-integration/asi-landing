/**
 * Neutral domain types for RU-first channel manager connections.
 * Separate from `src/lib/distribution` (OTA outbound runtime).
 */

export type ChannelManagerProviderCode =
  | 'realtycalendar'
  | 'bnovo'
  | 'travelline'
  | 'manual_import'
  | 'future';

export type ChannelConnectionStatus =
  | 'not_connected'
  | 'pending_setup'
  | 'connected'
  | 'disabled'
  | 'error';

export type ChannelSyncStatus =
  | 'never'
  | 'idle'
  | 'syncing'
  | 'succeeded'
  | 'failed';

export type ReservationImportStatus =
  | 'not_started'
  | 'pending'
  | 'partial'
  | 'complete'
  | 'failed';

export type ChannelManagerProviderAvailability = 'coming_soon' | 'manual' | 'on_request';

export type ChannelManagerProvider = {
  code: ChannelManagerProviderCode;
  displayName: string;
  /** Primary market focus for rollout ordering */
  primaryMarket: 'ru';
  availability: ChannelManagerProviderAvailability;
};

export type ConnectedProperty = {
  id: string;
  connectionId: string;
  provider: ChannelManagerProviderCode;
  label: string;
  externalPropertyId: string | null;
  connectionStatus: ChannelConnectionStatus;
  syncStatus: ChannelSyncStatus;
  reservationImportStatus: ReservationImportStatus;
  lastSyncAt: string | null;
  syncErrorMessage: string | null;
};

export type ChannelConnection = {
  id: string;
  accountId: string;
  provider: ChannelManagerProviderCode;
  connectionStatus: ChannelConnectionStatus;
  syncStatus: ChannelSyncStatus;
  reservationImportStatus: ReservationImportStatus;
  connectedProperties: ConnectedProperty[];
  lastSyncAt: string | null;
  syncErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChannelConnectionsWorkspaceSnapshot = {
  accountId: string;
  connections: ChannelConnection[];
  providers: ChannelManagerProvider[];
};
