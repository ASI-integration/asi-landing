import type {
  ChannelManagerDistributionTarget,
  OperationSyncStatus,
  PropertyListingIntake,
} from './types';

export const operationSyncStatusLabelsRu: Record<OperationSyncStatus, string> = {
  draft: 'Черновик',
  ready: 'Готово к отправке',
  queued: 'В очереди sync',
  syncing: 'Синхронизация',
  synced: 'Синхронизировано',
  needs_attention: 'Нужно внимание',
  blocked: 'Заблокировано',
};

export function getChannelSyncSummary(targets: ChannelManagerDistributionTarget[]) {
  return {
    total: targets.length,
    connected: targets.filter((target) => target.connected).length,
    synced: targets.filter((target) => target.syncStatus === 'synced').length,
    queued: targets.filter((target) => target.syncStatus === 'queued' || target.syncStatus === 'syncing').length,
    needsAttention: targets.filter(
      (target) => target.syncStatus === 'needs_attention' || target.syncStatus === 'blocked',
    ).length,
  };
}

export function isListingReadyForDistribution(listing: PropertyListingIntake): boolean {
  const hasApprovedMedia = listing.media.some((asset) => asset.kind === 'photo' && asset.distributionReady);
  const hasConnectedChannel = listing.distributionTargets.some((target) => target.connected);
  const hasRequiredText =
    listing.descriptionRu.length > 0 &&
    listing.amenitiesRu.length > 0 &&
    listing.houseRulesRu.length > 0 &&
    listing.checkInInstructionsRu.length > 0 &&
    listing.accessInfoRu.length > 0;

  return hasApprovedMedia && hasConnectedChannel && hasRequiredText && listing.intakeStatus !== 'blocked';
}

export function getPendingDistributionTargets(targets: ChannelManagerDistributionTarget[]) {
  return targets.filter((target) => target.syncStatus !== 'synced');
}

export function getDistributionReadinessLabel(listing: PropertyListingIntake): string {
  if (!isListingReadyForDistribution(listing)) return 'Карточка еще не готова к отправке';

  const summary = getChannelSyncSummary(listing.distributionTargets);

  if (summary.needsAttention > 0) return 'Готова, есть каналы с ручной проверкой';
  if (summary.synced === summary.total) return 'Синхронизирована во все каналы';
  return 'Готова к распределению по каналам';
}
