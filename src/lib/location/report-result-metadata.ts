import { isPublicProcurementLiveProbeEnabled } from './data-sources/public-procurement/public-procurement-live-client';
import { resolveEisOfficialConnectorConfig } from './data-sources/public-procurement/eis-official-config';

/** Mirrors `normalizeAddress` in `cache.ts` without server-only deps (safe for client bundles). */
export function normalizeReportAddress(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, ' ');
}

export type ProcurementSourceDisclosureStatus =
  | 'probe_disabled'
  | 'sample_cache'
  | 'official_api_disabled'
  | 'not_connected';

export type LocationReportSourceStatus = {
  current_location: 'live';
  urban_development: 'cache_or_not_connected';
  procurement: ProcurementSourceDisclosureStatus;
};

export type LocationReportDataFreshness = {
  /** Когда снимок текущей локации (карта / расчёт по координатам) зафиксирован для отчёта */
  currentLocationAsOfIso: string;
  /** Короткая строка для подписи без технических деталей */
  summaryRu: string;
};

export type LocationReportMapDisplay = 'available' | 'unavailable';

export type LocationReportResultMetadata = {
  calculatedAt: string;
  inputAddress: string;
  normalizedAddress: string;
  reportMode: 'free' | 'paid';
  dataFreshness: LocationReportDataFreshness;
  sourceStatus: LocationReportSourceStatus;
  /** Координаты расчёта — для отображения без внешней картографии */
  coordinates?: { lat: number; lon: number };
  /** Интерактивная карта не обязательна для просмотра отчёта */
  mapDisplay?: LocationReportMapDisplay;
  /** Предупреждения для UI (без технических кодов) */
  providerWarningsRu?: string[];
  /** Короткие формулировки для платного UI */
  clientFreshnessRu: {
    usedSources: string[];
    preparingSources: string[];
  };
};

type MetadataEnv = Record<string, string | undefined>;

export function resolveProcurementSourceDisclosureStatus(env?: MetadataEnv): ProcurementSourceDisclosureStatus {
  const bag = env ?? (typeof process !== 'undefined' ? process.env : undefined);
  const liveProbe = isPublicProcurementLiveProbeEnabled(bag);
  const eis = resolveEisOfficialConnectorConfig(bag);
  const eisOutboundReady = eis.connectorEnabled && !eis.outboundBlockedByCredentials;

  if (liveProbe) return 'probe_disabled';
  if (!eisOutboundReady) return 'official_api_disabled';
  return 'sample_cache';
}

export function buildLocationReportResultMetadata(init: {
  inputAddress: string;
  normalizedAddress?: string;
  reportMode: 'free' | 'paid';
  calculatedAtIso: string;
  env?: MetadataEnv;
  coordinates?: { lat: number; lon: number };
  mapDisplay?: LocationReportMapDisplay;
  providerWarningsRu?: string[];
}): LocationReportResultMetadata {
  const normalizedAddress = init.normalizedAddress ?? normalizeReportAddress(init.inputAddress);
  const procurement = resolveProcurementSourceDisclosureStatus(init.env);

  const sourceStatus: LocationReportSourceStatus = {
    current_location: 'live',
    urban_development: 'cache_or_not_connected',
    procurement,
  };

  const dataFreshness: LocationReportDataFreshness = {
    currentLocationAsOfIso: init.calculatedAtIso,
    summaryRu:
      'Текущая локация и транспортная доступность рассчитаны по актуальному снимку картографических данных на момент расчёта. '
      + 'Градостроительные и закупочные сигналы подключены частично и могут обновляться отдельным контуром данных.',
  };

  const clientFreshnessRu = buildClientFreshnessRu(sourceStatus, procurement);

  return {
    calculatedAt: init.calculatedAtIso,
    inputAddress: init.inputAddress.trim(),
    normalizedAddress,
    reportMode: init.reportMode,
    dataFreshness,
    sourceStatus,
    ...(init.coordinates ? { coordinates: init.coordinates } : {}),
    ...(init.mapDisplay ? { mapDisplay: init.mapDisplay } : {}),
    ...(init.providerWarningsRu?.length ? { providerWarningsRu: init.providerWarningsRu } : {}),
    clientFreshnessRu,
  };
}

function buildClientFreshnessRu(
  sourceStatus: LocationReportSourceStatus,
  procurement: ProcurementSourceDisclosureStatus,
): LocationReportResultMetadata['clientFreshnessRu'] {
  const usedSources = [
    'Окружение объекта, транспорт и точки притяжения спроса — по данным картографического слоя и расчёту по координатам (актуально на момент формирования отчёта).',
  ];

  if (procurement === 'sample_cache') {
    usedSources.push('Сигналы государственных закупок — справочный слой для методики (без персональных данных).');
  }

  const preparingSources: string[] = [];

  if (sourceStatus.urban_development === 'cache_or_not_connected') {
    preparingSources.push(
      'Градостроительные и инвестиционные сигналы — полная интеграция с живыми государственными источниками в подготовке; в отчёте используются доступные на сегодня прокси‑сигналы.',
    );
  }

  if (procurement === 'official_api_disabled' || procurement === 'not_connected') {
    preparingSources.push('Федеральный реестр закупок — официальный API для продукта не подключён; живые выгрузки ЕИС не используются в этом расчёте.');
  } else if (procurement === 'probe_disabled') {
    preparingSources.push('Живой режим закупочных данных включён на уровне инфраструктуры, но рабочий поток обращений к ЕИС пока не развёрнут — сигналы закупок не подмешиваются в расчёт.');
  }

  return { usedSources, preparingSources };
}

/** Строки для юнит‑тестов: не должны содержать технических маркеров или внутренних весов. */
export function clientFreshnessPlainTextRu(meta: LocationReportResultMetadata): string {
  const { usedSources, preparingSources } = meta.clientFreshnessRu;
  return [...usedSources, ...preparingSources].join('\n');
}
