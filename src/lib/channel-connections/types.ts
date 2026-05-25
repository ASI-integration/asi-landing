/**
 * Neutral domain types for RU-first channel manager connections.
 * Separate from `src/lib/distribution` (OTA outbound runtime).
 */

export type ChannelManagerProviderCode =
  | 'realtycalendar'
  | 'bnovo'
  | 'sutochno'
  | 'yandex_travel'
  | 'ozon_travel'
  | 'avito'
  | 'cian'
  | 'hotels_101'
  | 'otello'
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

export type ChannelManagerProviderAvailability =
  | 'available'
  | 'foundation'
  | 'manual'
  | 'on_request'
  | 'planned';

export type ChannelManagerProviderKind =
  | 'channel_manager'
  | 'ota_adapter'
  | 'marketplace_adapter'
  | 'manual'
  | 'custom';

export type ChannelManagerProvider = {
  code: ChannelManagerProviderCode;
  displayName: string;
  /** Primary market focus for rollout ordering */
  primaryMarket: 'ru';
  availability: ChannelManagerProviderAvailability;
  kind: ChannelManagerProviderKind;
  description: string;
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
