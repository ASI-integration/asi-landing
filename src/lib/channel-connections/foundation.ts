import { CHANNEL_MANAGER_PROVIDERS } from './providers';
import type {
  ChannelConnection,
  ChannelConnectionsWorkspaceSnapshot,
  ChannelManagerProviderCode,
} from './types';

/**
 * Foundation snapshot for dashboard/API — no external provider calls or credentials.
 */
export function buildChannelConnectionsFoundationSnapshot(
  accountId: string,
): ChannelConnectionsWorkspaceSnapshot {
  return {
    accountId,
    providers: [...CHANNEL_MANAGER_PROVIDERS],
    connections: [],
  };
}

export function buildPlaceholderConnection(
  accountId: string,
  provider: ChannelManagerProviderCode,
): ChannelConnection {
  const now = new Date().toISOString();
  return {
    id: `placeholder-${provider}`,
    accountId,
    provider,
    connectionStatus: 'not_connected',
    syncStatus: 'never',
    reservationImportStatus: 'not_started',
    connectedProperties: [],
    lastSyncAt: null,
    syncErrorMessage: null,
    createdAt: now,
    updatedAt: now,
  };
}
