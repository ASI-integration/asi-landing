import type {
  ChannelDistributionPackage,
  ChannelManagerDistributionTarget,
  OperationSyncStatus,
  PropertyListingIntake,
} from './types';
import { validateListingIntakeDraft } from './listingIntake';

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
  const hasRequiredFields = validateListingIntakeDraft(listing).isValid;

  return hasApprovedMedia && hasConnectedChannel && hasRequiredFields && listing.intakeStatus !== 'blocked';
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

export function prepareChannelDistributionPackage(listing: PropertyListingIntake): ChannelDistributionPackage {
  const validation = validateListingIntakeDraft(listing);
  const payloadFieldsRu = [
    'Название',
    'Город',
    'Адрес',
    'Описание',
    'Фото',
    'Удобства',
    'Правила дома',
    'Инструкции заезда',
    'Инструкции выезда',
    'Доступы',
    'Клининг',
    'Контакт мастера',
  ];

  return {
    listingId: listing.id,
    propertyNameRu: listing.propertyNameRu,
    cityRu: listing.cityRu,
    ready: validation.isValid,
    statusRu: validation.isValid ? 'Готово к отправке на площадки' : 'Нужно заполнить обязательные поля',
    targets: listing.distributionTargets.map((target) => ({
      channelId: target.channelId,
      channelNameRu: target.channelNameRu,
      syncStatus: target.syncStatus,
      canQueueSync: validation.isValid && target.connected && target.syncStatus !== 'blocked',
      payloadFieldsRu,
      missingFieldsRu: validation.isValid ? target.pendingFieldsRu : validation.missingFieldsRu,
    })),
  };
}
