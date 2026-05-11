'use client';

import { useState, useEffect, useId, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { extractRuCityFromValue } from '@/lib/location/address-providers/ru-normalize';
import {
  CATEGORY_COLOR,
  buildAnalysis,
  buildLocationStandaloneReport,
  buildCommercialReport,
  buildLocationReportPermalink,
  LOCATION_REPORT_PRODUCT_PATH,
  LOCATION_REPORT_SAMPLE_PATH,
  getBand,
  formatDist,
  projectToSVG,
  patchLegacyLocationAnalysis,
  buildCommercialFormatFit,
  FIT_LEVEL_LABEL_RU,
  FIT_LEVEL_COLOR,
} from '@/lib/location/client';
import type {
  LocationAnalysis,
  MagnetItem,
  Band,
  AnalysisMeta,
  DemandType,
  NeighborhoodEnvironmentConcernLevel,
  ResidentialDemoSanity,
} from '@/lib/location/client';
import {
  useLocationTelemetryOptional,
  type LocationTelemetrySnapshot,
} from '@/context/landing-location-telemetry';
import {
  LOC_COPY,
  footTrafficForLocale,
  competitorLabel,
  magnetCategoryLabel,
  magnetWhy,
  type LocDemoLocale,
} from '@/components/location-intelligence-locale';
import { generateConclusion } from '@/lib/location/client';
import { selectResidentialPrimeMagnetItems } from '@/lib/location/residential-prime-magnets';
import { applyResidentialDemoSanity } from '@/lib/location/client';
import { strategicHubFreeBriefRu } from '@/lib/location/strategic-transport-hub';
import { specializedMedicalFreeBriefRu } from '@/lib/location/specialized-medical-anchor';
import {
  normalizeRuDemoExplanationLines,
  sanitizeRuFactorList,
} from '@/lib/location/demo-public-copy';
import {
  readRecentAddressesFromStorage,
  rememberRecentAddress,
} from '@/lib/location/recent-addresses';

// ── Device detection ──────────────────────────────────────────────────────────

function getExternalMapUrl(address: string): string {
  if (typeof navigator === 'undefined') {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  }
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  return isIOS
    ? `http://maps.apple.com/?q=${encodeURIComponent(address)}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function isIOS(): boolean {
  return typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

// ── UI-only types ─────────────────────────────────────────────────────────────

interface Suggestion {
  value: string;
  lat: string | null;
  lon: string | null;
  placeId?: string;
  twogisItemId?: string;
}

interface SelectedAddress {
  value: string;
  lat: number;
  lon: number;
}

type SuggestStatus = 'idle' | 'ok' | 'no_results' | 'no_key' | 'error';
type AnalysisMetaWithDemoSanity = AnalysisMeta & { demoSanity?: ResidentialDemoSanity };

// ── Address suggestion fetch (server-side locale routing; no browser Maps SDK) ─

const SUGGEST_TIMEOUT_MS = 8_000;
const RESOLVE_TIMEOUT_MS = 12_000;
/** Must allow Overpass + server cache work; short timeouts yield `buildAnalysis([])` fallback. */
const LOCATION_ANALYSIS_FETCH_MS = 55_000;

function truncateForLog(s: string, max = 52): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

// City-context priority for RU autocomplete:
//   a) explicit city in the query   (resolved server-side)
//   b) last-selected address city   (sessionStorage)
//   c) browser geolocation viewport (lat/lon, no reverse-geocode)
//   d) previous-session city        (sessionStorage, persists across reloads)
//   e) none — nationwide; UI must show city in suggestion labels
const LAST_CITY_KEY = 'location-demo:lastCity';
const PREV_CITY_KEY = 'location-demo:prevCity';

interface CityHint {
  cityHint?: string;
  biasLat?: number;
  biasLon?: number;
  source: 'session' | 'geolocation' | 'previous' | 'none';
}

function readSessionString(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.sessionStorage.getItem(key);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

function writeSessionString(key: string, value: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (value) window.sessionStorage.setItem(key, value);
    else window.sessionStorage.removeItem(key);
  } catch {
    /* ignore quota/private-mode errors */
  }
}

function rememberSelectedCity(suggestionValue: string): void {
  const city = extractRuCityFromValue(suggestionValue);
  if (!city) return;
  // Roll the previous "last" forward into "prev" so cold reloads still have
  // a session-level fallback even if the user clears their last pick.
  const existing = readSessionString(LAST_CITY_KEY);
  if (existing && existing !== city) writeSessionString(PREV_CITY_KEY, existing);
  writeSessionString(LAST_CITY_KEY, city);
}

function resolveCityHint(geo: { lat: number; lon: number } | null): CityHint {
  const last = readSessionString(LAST_CITY_KEY);
  if (last) return { cityHint: last, source: 'session' };
  if (geo) return { biasLat: geo.lat, biasLon: geo.lon, source: 'geolocation' };
  const prev = readSessionString(PREV_CITY_KEY);
  if (prev) return { cityHint: prev, source: 'previous' };
  return { source: 'none' };
}

async function fetchAddressSuggestions(
  locale: LocDemoLocale,
  q: string,
  externalSignal?: AbortSignal,
  hint?: CityHint,
): Promise<{ suggestions: Suggestion[]; status: SuggestStatus }> {
  const merged = new AbortController();
  const extHandler = () => merged.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      const stale = new Error('Stale suggest request');
      stale.name = 'AbortError';
      throw stale;
    }
    externalSignal.addEventListener('abort', extHandler, { once: true });
  }
  const timeoutId = setTimeout(() => merged.abort(), SUGGEST_TIMEOUT_MS);
  const qLog = truncateForLog(q, 48);
  console.info('[location-demo] addressSuggest request_start', { locale, qLen: q.length, q: qLog });
  try {
    const url = new URL('/api/address-suggest', window.location.origin);
    url.searchParams.set('q', q);
    url.searchParams.set('locale', locale);
    if (hint && locale === 'ru') {
      if (hint.cityHint) url.searchParams.set('cityHint', hint.cityHint);
      if (Number.isFinite(hint.biasLat) && Number.isFinite(hint.biasLon)) {
        url.searchParams.set('biasLat', String(hint.biasLat));
        url.searchParams.set('biasLon', String(hint.biasLon));
      }
      url.searchParams.set('cityHintSource', hint.source);
    }
    const res = await fetch(url.toString().replace(window.location.origin, ''), {
      signal: merged.signal,
      cache: 'no-store',
    });
    const data = (await res.json()) as {
      suggestions?: Array<{
        value: string;
        lat: string | null;
        lon: string | null;
        placeId?: string;
        twogisItemId?: string;
      }>;
      status?: string;
    };
    const pipelineStatus = typeof data.status === 'string' ? data.status : undefined;
    const suggestions: Suggestion[] = (data.suggestions ?? []).map(s => ({
      value: s.value,
      lat: s.lat,
      lon: s.lon,
      placeId: s.placeId,
      twogisItemId: s.twogisItemId,
    }));
    if (!res.ok) {
      console.warn('[location-demo] addressSuggest http_error', { httpStatus: res.status, pipelineStatus });
      return { suggestions: [], status: 'error' };
    }
    console.info('[location-demo] addressSuggest response', {
      pipelineStatus,
      suggestionCount: suggestions.length,
    });
    if (pipelineStatus === 'no_key') return { suggestions: [], status: 'no_key' };
    if (pipelineStatus === 'error') return { suggestions: [], status: 'error' };
    if (suggestions.length === 0) {
      return { suggestions: [], status: 'no_results' };
    }
    return { suggestions, status: 'ok' };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e;
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[location-demo] addressSuggest client_error', { msg, q: qLog });
    return { suggestions: [], status: 'error' };
  } finally {
    clearTimeout(timeoutId);
    if (externalSignal) externalSignal.removeEventListener('abort', extHandler);
  }
}

async function fetchLocationAnalysis(
  lat: number,
  lon: number,
  signal?: AbortSignal,
  opts?: { spatialFoundation?: boolean },
): Promise<{ analysis: LocationAnalysis; meta: AnalysisMeta } | null> {
  try {
    const res = await fetch('/api/location-demo-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat,
        lon,
        // Used only to localize warning strings from the server.
        locale: typeof window !== 'undefined' && window.location?.pathname?.startsWith('/ru') ? 'ru' : 'en',
        ...(opts?.spatialFoundation ? { spatialFoundation: true } : {}),
      }),
      signal,
    });
    if (!res.ok) return null;
    const data = await res.json() as {
      analysis?: LocationAnalysis;
      meta?: AnalysisMetaWithDemoSanity;
      demoSanity?: ResidentialDemoSanity;
    };
    if (!data.analysis) return null;
    const analysis: LocationAnalysis = patchLegacyLocationAnalysis({
      ...data.analysis,
      accessibilityStops: data.analysis.accessibilityStops ?? [],
    });
    const metaBase: AnalysisMetaWithDemoSanity = data.meta ?? {
      freshness: 'fresh',
      updatedAt: new Date().toISOString(),
      source: 'osm-overpass',
      cached: false,
    };
    const meta: AnalysisMetaWithDemoSanity = data.demoSanity
      ? { ...metaBase, demoSanity: data.demoSanity }
      : metaBase;
    return { analysis, meta };
  } catch {
    return null;
  }
}

function formatUpdatedRelative(iso: string, c: (typeof LOC_COPY)['en']): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return c.analysisFreshness.justUpdated;
  if (m < 60) return c.analysisFreshness.updatedMinutesAgo(m);
  const h = Math.floor(m / 60);
  if (h < 48) return c.analysisFreshness.updatedHoursAgo(h);
  return c.analysisFreshness.updatedOn(iso);
}

function formatUpdatedAtReadable(iso: string, locale: LocDemoLocale): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function demandTypeLabel(d: DemandType, locale: LocDemoLocale): string {
  if (locale === 'ru') {
    const map: Record<DemandType, string> = {
      'tourism-led': 'туристический',
      'business-led': 'деловой',
      'transport-led': 'транзитный',
      'mixed': 'смешанный',
    };
    return map[d];
  }
  const map: Record<DemandType, string> = {
    'tourism-led': 'tourism',
    'business-led': 'business',
    'transport-led': 'transit',
    'mixed': 'mixed',
  };
  return map[d];
}

function sourceDataLabel(meta: AnalysisMeta | null, c: (typeof LOC_COPY)['en']): string {
  if (!meta) return c === LOC_COPY.ru ? 'локальный расчёт (нет метаданных сервера)' : 'local calculation (no server metadata)';
  const fromCache = meta.cached;
  const refreshing = Boolean(meta.refreshing);
  const isStale = meta.freshness === 'stale';
  if (fromCache) {
    if (refreshing && isStale) return c.analysisFreshness.sourceCacheUpdating;
    return c.analysisFreshness.sourceCache;
  }
  return c.analysisFreshness.sourceFresh;
}

function dataFreshnessLabel(meta: AnalysisMeta | null, c: (typeof LOC_COPY)['en']): string {
  if (!meta) return c.analysisFreshness.dataCurrent;
  const refreshing = Boolean(meta.refreshing);
  const isStale = meta.freshness === 'stale';
  if (refreshing && isStale) return c.analysisFreshness.dataUpdating;
  if (isStale) return c.analysisFreshness.snapshotStale;
  return c.analysisFreshness.dataCurrent;
}

function emitAnalysisTelemetry(
  pushLine: (entry: { badge: string; text: string; kind: 'ok' | 'info' | 'warn' }) => void,
  updateSnapshot: (patch: Partial<LocationTelemetrySnapshot>) => void,
  analysis: LocationAnalysis,
  meta: AnalysisMeta | null,
  locale: LocDemoLocale,
  c: (typeof LOC_COPY)['en'],
) {
  if (locale === 'ru') {
    pushLine({ badge: 'SRC', text: `источник данных: ${sourceDataLabel(meta, c)}`, kind: 'ok' });
    pushLine({ badge: 'MAG', text: `магнитов найдено: ${analysis.magnets.length}`, kind: 'info' });
    pushLine({ badge: 'CMP', text: `конкурентов найдено: ${analysis.competitors.length}`, kind: 'info' });
    pushLine({ badge: 'DM', text: `тип спроса: ${demandTypeLabel(analysis.demandType, locale)}`, kind: 'info' });
  } else {
    pushLine({ badge: 'SRC', text: `data source: ${sourceDataLabel(meta, c)}`, kind: 'ok' });
    pushLine({ badge: 'MAG', text: `magnets found: ${analysis.magnets.length}`, kind: 'info' });
    pushLine({ badge: 'CMP', text: `competitors found: ${analysis.competitors.length}`, kind: 'info' });
    pushLine({ badge: 'DM', text: `demand type: ${demandTypeLabel(analysis.demandType, locale)}`, kind: 'info' });
  }
  pushLine({
    badge: 'IDX',
    text: locale === 'ru'
      ? `индекс локации обновлён · ${analysis.evergreenIndex}`
      : `location index updated · ${analysis.evergreenIndex}`,
    kind: 'ok',
  });
  const fresh = dataFreshnessLabel(meta, c);
  const freshKind: 'ok' | 'warn' = fresh === c.analysisFreshness.dataCurrent ? 'ok' : 'warn';
  pushLine({ badge: '···', text: fresh, kind: freshKind });
  if (meta?.usedFallbackQuery) {
    pushLine({
      badge: '⚠',
      text: locale === 'ru'
        ? 'часть запросов к карте выполнена в упрощённом режиме'
        : `some map queries ran in ${c.analysisFreshness.simplifiedMode}`,
      kind: 'warn',
    });
  }
  updateSnapshot({
    evergreenIndex: analysis.evergreenIndex,
    magnetCount: analysis.magnets.length,
    competitorCount: analysis.competitors.length,
    demandTypeLabel: demandTypeLabel(analysis.demandType, locale),
    dataStatusLabel: fresh,
  });
}

// ── Demand stability helpers ──────────────────────────────────────────────────

function calculateDemandStability(data: { seasonality?: number; competitors?: number }): number {
  const seasonalityFactor = data.seasonality ?? 0.5;
  const competition = data.competitors ?? 10;
  const varianceProxy =
    (1 - seasonalityFactor) * 0.6 +
    Math.min(competition / 20, 1) * 0.4;
  const stability = 1 - varianceProxy;
  return Math.max(0, Math.min(1, stability));
}

function getStabilityLabel(stability: number, locale: LocDemoLocale): string {
  if (locale === 'ru') {
    if (stability > 0.7) return 'устойчивый';
    if (stability > 0.4) return 'средний';
    return 'нестабильный';
  }
  if (stability > 0.7) return 'Stable';
  if (stability > 0.4) return 'Moderate';
  return 'Unstable';
}

function inferSeasonalityFactor(demandType: DemandType): number {
  const map: Record<DemandType, number> = {
    'business-led':   0.8,
    'mixed':          0.5,
    'transport-led':  0.5,
    'tourism-led':    0.25,
  };
  return map[demandType];
}

// ── Info tooltip ──────────────────────────────────────────────────────────────

function InfoTooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span
      className="relative inline-flex items-center ml-1 align-middle"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <svg
        width="12" height="12" viewBox="0 0 12 12" fill="none"
        className="text-slate-600 cursor-help"
        aria-hidden="true"
      >
        <circle cx="6" cy="6" r="5.5" stroke="currentColor" strokeWidth="1" />
        <text x="6" y="9.5" textAnchor="middle" fill="currentColor" fontSize="7.5" fontWeight="700" fontFamily="inherit">i</text>
      </svg>
      {show && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300 shadow-xl z-20 pointer-events-none leading-snug">
          {text}
        </div>
      )}
    </span>
  );
}

// ── Market Snapshot table ─────────────────────────────────────────────────────

function MarketSnapshotTable({
  evergreenIndex,
  demandType,
  competitorCount,
  strategy,
  locale,
  c,
}: {
  evergreenIndex: number;
  demandType: DemandType;
  competitorCount: number;
  strategy: 'mid_term' | 'hybrid' | 'short_term';
  locale: LocDemoLocale;
  c: (typeof LOC_COPY)['en'];
}) {
  const inferredSeasonality = inferSeasonalityFactor(demandType);
  const demandStability = calculateDemandStability({
    seasonality: inferredSeasonality,
    competitors: competitorCount,
  });
  const stabilityLabel = getStabilityLabel(demandStability, locale);

  const demandLevelMap: Record<DemandType, string> = {
    'tourism-led':   'Tourism',
    'business-led':  'Business',
    'transport-led': 'Transit',
    'mixed':         'Mixed',
  };
  const strategyLabelMap: Record<typeof strategy, string> = {
    short_term: 'Short-term rental',
    hybrid:     'Hybrid (short + mid)',
    mid_term:   'Mid-term rental',
  };

  const adr =
    strategy === 'short_term' ? Math.round(85 + evergreenIndex * 0.5)
    : strategy === 'hybrid'   ? Math.round(65 + evergreenIndex * 0.4)
    :                           Math.round(45 + evergreenIndex * 0.3);
  const occupancy = Math.round(50 + (evergreenIndex / 100) * 35);
  const revpar = Math.round(adr * occupancy / 100);
  const isRu = locale === 'ru';
  const adrRub = Math.round(
    strategy === 'short_term' ? (2500 + evergreenIndex * 22)
    : strategy === 'hybrid'   ? (2000 + evergreenIndex * 18)
    :                           (1600 + evergreenIndex * 13),
  );
  const revparRub = Math.round(adrRub * occupancy / 100);
  const fmtRub = (n: number) => `${(Math.round(n / 500) * 500).toLocaleString('ru-RU')} ₽`;

  const stabilityDotColor =
    stabilityLabel === 'Stable'   ? 'bg-emerald-400'
    : stabilityLabel === 'Moderate' ? 'bg-amber-400'
    :                                 'bg-orange-400';

  const rows: Array<{ label: string; value: React.ReactNode; tooltip?: string }> = [
    { label: c.marketRows.locationScore,    value: `${evergreenIndex} / 100` },
    { label: c.marketRows.demandLevel,      value: demandLevelMap[demandType] },
    {
      label: c.marketRows.demandStability,
      value: (
        <span className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full shrink-0 ${stabilityDotColor}`} />
          {stabilityLabel}
        </span>
      ),
      tooltip: c.marketTooltips.demandStability,
    },
    { label: c.marketRows.competitors500m, value: `${competitorCount}` },
    { label: c.marketRows.avgAdr,          value: isRu ? fmtRub(adrRub) : `$${adr}`,       tooltip: c.marketTooltips.avgAdr },
    { label: c.marketRows.estOccupancy,    value: `${occupancy}%`, tooltip: c.marketTooltips.estOccupancy },
    { label: c.marketRows.revpar,          value: isRu ? fmtRub(revparRub) : `$${revpar}`, tooltip: c.marketTooltips.revpar },
    { label: c.marketRows.strategy,        value: strategyLabelMap[strategy] },
  ];

  return (
    <div className="px-5 py-5 border-b border-slate-800/40">
      <p className="text-[11px] text-slate-500 uppercase tracking-[0.16em] mb-4">{c.marketSnapshotTitle}</p>
      <p className="text-[12px] text-slate-500 mb-4">{c.marketSnapshotNote}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {rows.map((row) => (
          <div key={row.label}>
            <p className="text-[11px] text-slate-500 uppercase tracking-[0.12em] mb-0.5 flex items-center">
              {row.label}
              {row.tooltip && <InfoTooltip text={row.tooltip} />}
            </p>
            <p className="text-base text-slate-100 font-medium leading-snug">{row.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnalysisFreshnessStrip({ meta, locale, c }: { meta: AnalysisMeta; locale: LocDemoLocale; c: (typeof LOC_COPY)['en'] }) {
  const isStale = meta.freshness === 'stale';
  const refreshing = Boolean(meta.refreshing);
  const fromCache = meta.cached;

  let statusLabel: string;
  let statusClass: string;
  if (refreshing && isStale) {
    statusLabel = c.analysisFreshness.dataUpdating;
    statusClass = 'text-amber-400';
  } else if (isStale) {
    statusLabel = c.analysisFreshness.snapshotStale;
    statusClass = 'text-slate-400';
  } else {
    statusLabel = c.analysisFreshness.dataCurrent;
    statusClass = 'text-emerald-400';
  }

  const sourceKind = fromCache
    ? (refreshing && isStale ? c.analysisFreshness.sourceCacheUpdating : c.analysisFreshness.sourceCache)
    : c.analysisFreshness.sourceFresh;
  const baseSource = c.analysisFreshness.sourceOpenStreetMap;

  return (
    <div className="px-5 py-2 border-b border-slate-800/40 bg-slate-950/30 flex flex-wrap items-center gap-x-3 gap-y-0.5">
      <span className={`text-[11px] font-semibold uppercase tracking-[0.15em] ${statusClass}`}>{statusLabel}</span>
      <span className="text-[11px] text-slate-600">{formatUpdatedRelative(meta.updatedAt, c)}</span>
      <span className="text-[11px] text-slate-700">{baseSource} · {sourceKind}{meta.usedFallbackQuery ? ` · ${c.analysisFreshness.simplifiedMode}` : ''}</span>
    </div>
  );
}

function ConfidenceWarningsStrip({ meta, locale }: { meta: AnalysisMeta; locale: LocDemoLocale }) {
  const confidence = meta.confidence;
  const warnings = meta.warnings ?? [];
  if (!confidence && warnings.length === 0) return null;

  if (locale === 'ru') {
    return (
      <div className="px-5 py-2 border-b border-slate-800/40 bg-slate-950/20">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400">
            Демо-режим
          </span>
          <span className="text-[11px] text-slate-500">
            Часть картографических сигналов ограничена
          </span>
        </div>
      </div>
    );
  }

  const confLabel =
    confidence === 'high'
      ? 'high confidence'
      : confidence === 'medium'
        ? 'medium confidence'
        : confidence === 'low'
          ? 'low confidence'
          : null;

  const confClass =
    confidence === 'high' ? 'text-emerald-400'
    : confidence === 'medium' ? 'text-amber-400'
    : confidence === 'low' ? 'text-orange-400'
    : 'text-slate-400';

  return (
    <div className="px-5 py-2 border-b border-slate-800/40 bg-slate-950/20">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {confLabel ? (
          <span className={`text-[11px] font-semibold uppercase tracking-[0.15em] ${confClass}`}>
            {confLabel}
          </span>
        ) : null}
        {warnings.slice(0, 3).map((w) => (
          <span key={w.code} className="text-[11px] text-slate-400">
            {w.message}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Idle map panel ─────────────────────────────────────────────────────────────

const BLOBS = [
  { top: 28, left: 24, size: 130, op: 0.18 },
  { top: 52, left: 60, size: 160, op: 0.14 },
  { top: 18, left: 70, size: 90,  op: 0.22 },
  { top: 72, left: 38, size: 110, op: 0.11 },
  { top: 62, left: 78, size: 75,  op: 0.16 },
];

const DOT_POOL = [
  { top: 14, left: 12 }, { top: 11, left: 35 }, { top: 18, left: 58 }, { top: 12, left: 80 },
  { top: 34, left: 22 }, { top: 40, left: 48 }, { top: 37, left: 72 }, { top: 31, left: 90 },
  { top: 58, left: 15 }, { top: 62, left: 40 }, { top: 55, left: 65 }, { top: 61, left: 85 },
  { top: 80, left: 28 }, { top: 76, left: 52 }, { top: 83, left: 74 }, { top: 78, left: 92 },
];

function IdleMapPanel({ locale, c }: { locale: LocDemoLocale; c: (typeof LOC_COPY)['en'] }) {
  const [activeDots, setActiveDots] = useState<number[]>([]);

  useEffect(() => {
    function pick() {
      const count = 2 + Math.floor(Math.random() * 3);
      const shuffled = [...DOT_POOL.keys()].sort(() => Math.random() - 0.5);
      setActiveDots(shuffled.slice(0, count));
    }
    pick();
    const id = setInterval(pick, 1600);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="relative w-full rounded-2xl border border-slate-800 overflow-hidden"
      style={{ height: 420 }}
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),' +
            'linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          backgroundColor: '#0d1117',
        }}
      />
      <div className="absolute inset-0">
        {BLOBS.map((b, i) => (
          <div
            key={i}
            className="absolute rounded-full pointer-events-none"
            style={{
              top: `${b.top}%`, left: `${b.left}%`,
              width: b.size, height: b.size,
              background: 'radial-gradient(circle, rgba(99,102,241,1) 0%, transparent 70%)',
              opacity: b.op, filter: 'blur(22px)', transform: 'translate(-50%, -50%)',
            }}
          />
        ))}
      </div>
      {DOT_POOL.map((d, i) => {
        const isActive = activeDots.includes(i);
        return (
          <span
            key={i}
            className="absolute rounded-full pointer-events-none"
            style={{
              top: `${d.top}%`, left: `${d.left}%`,
              width: isActive ? 7 : 4, height: isActive ? 7 : 4,
              transform: 'translate(-50%, -50%)',
              background: isActive ? '#818cf8' : '#1e293b',
              boxShadow: isActive ? '0 0 10px 4px rgba(99,102,241,0.35)' : 'none',
              opacity: isActive ? 0.9 : 0.25,
              transition: 'all 0.5s ease',
            }}
          />
        );
      })}
      {activeDots.map((idx) => {
        const d = DOT_POOL[idx];
        return (
          <span
            key={`ring-${idx}`}
            className="absolute rounded-full pointer-events-none animate-ping"
            style={{
              top: `${d.top}%`, left: `${d.left}%`,
              width: 12, height: 12,
              transform: 'translate(-50%, -50%)',
              border: '1px solid rgba(99,102,241,0.5)',
              animationDuration: `${1.2 + (idx % 5) * 0.3}s`,
              opacity: 0.4,
            }}
          />
        );
      })}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="text-center px-6">
          <div className="w-11 h-11 rounded-full border border-slate-700/60 bg-slate-900/70 flex items-center justify-center mx-auto mb-3">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M9 1.5C6.1 1.5 3.75 3.85 3.75 6.75c0 4.22 5.25 9.75 5.25 9.75s5.25-5.53 5.25-9.75C14.25 3.85 11.9 1.5 9 1.5zm0 7a2.25 2.25 0 110-4.5 2.25 2.25 0 010 4.5z" fill="rgba(99,102,241,0.45)" />
            </svg>
          </div>
          <p className="text-base font-medium text-slate-400">{c.addressPlaceholder}</p>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed">
            {c.idleMapAnalysisLead}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Map loading overlay (shared) ─────────────────────────────────────────────

function MapLoadingOverlay({ c }: { c: (typeof LOC_COPY)['en'] }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-sm rounded-2xl">
      <div className="w-7 h-7 border-2 border-slate-700 border-t-indigo-400 rounded-full animate-spin mb-4" />
      <p className="text-white font-semibold text-sm">{c.mapLoadingTitle}</p>
      <p className="mt-1 text-xs text-slate-500">{c.mapLoadingSub}</p>
    </div>
  );
}

// ── 2GIS Map Panel ────────────────────────────────────────────────────────────
// Primary map. Two render paths:
//   1. NEXT_PUBLIC_TWOGIS_API_KEY set  → MapGL JS SDK canvas (mapgl.2gis.com/api/js/v1)
//   2. No key                          → 2GIS iframe embed (real 2GIS tiles, no key needed)
// OSMMapPanel below is the last-resort fallback if 2GIS embed itself errors.

function TwoGISMapPanel({
  lat,
  lon,
  loading,
  locale: _locale,
  c,
  height = 420,
}: {
  lat: number;
  lon: number;
  loading: boolean;
  locale: LocDemoLocale;
  c: (typeof LOC_COPY)['en'];
  height?: number;
}) {
  const apiKey = process.env.NEXT_PUBLIC_TWOGIS_API_KEY;
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [sdkError, setSdkError] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [iframeError, setIframeError] = useState(false);

  useEffect(() => {
    if (!apiKey || !mapContainerRef.current) return;

    let mapInstance: { destroy: () => void } | null = null;
    let scriptEl: HTMLScriptElement | null = null;

    const existingScript = document.getElementById('mapgl-api-script');
    const initMap = () => {
      try {
        const w = window as unknown as { mapgl: { Map: new (el: HTMLDivElement, opts: object) => { destroy: () => void }; Marker: new (map: object, opts: object) => void } };
        mapInstance = new w.mapgl.Map(mapContainerRef.current!, {
          center: [lon, lat],
          zoom: 16,
          key: apiKey,
        });
        new w.mapgl.Marker(mapInstance, { coordinates: [lon, lat] });
        setSdkReady(true);
      } catch {
        setSdkError(true);
      }
    };

    if (existingScript) {
      initMap();
    } else {
      scriptEl = document.createElement('script');
      scriptEl.id = 'mapgl-api-script';
      scriptEl.src = 'https://mapgl.2gis.com/api/js/v1';
      scriptEl.onload = initMap;
      scriptEl.onerror = () => setSdkError(true);
      document.head.appendChild(scriptEl);
    }

    return () => {
      mapInstance?.destroy();
    };
  }, [lat, lon, apiKey]);

  // Silent fail: if SDK errored, show nothing (no error text)
  if (apiKey && sdkError) return null;

  // Path 1: MapGL SDK
  if (apiKey) {
    return (
      <div
        className="relative w-full rounded-2xl border border-slate-800 overflow-hidden h-[320px] sm:h-[380px] lg:h-[360px] xl:h-[420px]"
      >
        <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
        {(!sdkReady || loading) && <MapLoadingOverlay c={c} />}
      </div>
    );
  }

  // Path 2: OSM iframe (reliable fallback when no 2GIS SDK key)
  if (iframeError) return null;

  const deltaLat = 0.005;
  const deltaLon = 0.009;
  const bbox = `${lon - deltaLon},${lat - deltaLat},${lon + deltaLon},${lat + deltaLat}`;
  const osmSrc = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(`${lat},${lon}`)}`;

  return (
    <div
      className="relative w-full rounded-2xl border border-slate-800 overflow-hidden h-[320px] sm:h-[380px] lg:h-[360px] xl:h-[420px]"
    >
      <iframe
        src={osmSrc}
        width="100%"
        height="100%"
        frameBorder="0"
        allowFullScreen
        title={c.mapTitleOsm}
        loading="lazy"
        style={{ display: 'block' }}
        onError={() => setIframeError(true)}
      />
      {loading && <MapLoadingOverlay c={c} />}
    </div>
  );
}

// ── OSM Map Panel (fallback only) ─────────────────────────────────────────────

function OSMMapPanel({
  lat,
  lon,
  loading,
  c,
}: {
  lat: number;
  lon: number;
  loading: boolean;
  c: (typeof LOC_COPY)['en'];
}) {
  const deltaLat = 0.005;
  const deltaLon = 0.009;
  const bbox = `${lon - deltaLon},${lat - deltaLat},${lon + deltaLon},${lat + deltaLat}`;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(`${lat},${lon}`)}`;
  return (
    <div
      className="relative w-full rounded-2xl border border-slate-800 overflow-hidden"
      style={{ height: 420 }}
    >
      <iframe
        src={src}
        width="100%"
        height="100%"
        frameBorder="0"
        allowFullScreen
        title={c.mapTitleOsm}
        loading="lazy"
        style={{ display: 'block' }}
      />
      {loading && <MapLoadingOverlay c={c} />}
    </div>
  );
}

// ── Influence Heatmap Panel ───────────────────────────────────────────────────
// SVG visualization of computed attraction + competitor pressure.
// Every point is derived from real OSM-detected objects and real scores — no decoration.

const SVG_W = 400;
const SVG_H = 280;


function InfluenceHeatmapPanel({
  analysis,
  subjectLat,
  subjectLon,
  locale,
  c,
}: {
  analysis: LocationAnalysis;
  subjectLat: number;
  subjectLon: number;
  locale: LocDemoLocale;
  c: (typeof LOC_COPY)['en'];
}) {
  const { heatmapPoints } = analysis;
  const footTraffic = footTrafficForLocale(analysis.footTraffic, locale);

  if (heatmapPoints.length === 0) return null;

  const { projected, subjectXY } = projectToSVG(
    heatmapPoints,
    subjectLat,
    subjectLon,
    SVG_W,
    SVG_H,
  );

  return (
    <div className="mt-4 rounded-2xl border border-slate-800 overflow-hidden bg-slate-950">
      {/* Header */}
      <div className="px-4 pt-3 pb-2 flex items-center gap-2 border-b border-slate-800/60">
        <span className="text-[18px] font-semibold uppercase tracking-[0.2em] text-indigo-400">
          {c.heatmapHeader}
        </span>
        <span className="text-[17px] text-slate-700">{c.heatmapSub}</span>
      </div>

      {/* SVG heatmap */}
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        width="100%"
        height={SVG_H}
        style={{ display: 'block', background: '#080c14' }}
        aria-label={c.heatmapAria}
      >
        <defs>
          {/* Blur filter for halo glow */}
          <filter id="halo-blur" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="10" result="blur" />
          </filter>
          <filter id="dot-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          {/* Subject marker glow */}
          <filter id="subject-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Grid lines (faint) */}
        {[0.25, 0.5, 0.75].map(f => (
          <g key={f}>
            <line x1={SVG_W * f} y1={0} x2={SVG_W * f} y2={SVG_H} stroke="rgba(255,255,255,0.025)" strokeWidth="1" />
            <line x1={0} y1={SVG_H * f} x2={SVG_W} y2={SVG_H * f} stroke="rgba(255,255,255,0.025)" strokeWidth="1" />
          </g>
        ))}

        {/* ── Halo layer (blurred, behind dots) ── */}
        {projected.map((p, i) => {
          const color = p.type === 'competitor'
            ? CATEGORY_COLOR.competitor
            : CATEGORY_COLOR[p.categoryId] ?? '#818cf8';
          // Halo radius: 18–52px, scaled by intensity
          const haloR = 18 + p.intensity * 34;
          return (
            <circle
              key={`halo-${i}`}
              cx={p.x} cy={p.y}
              r={haloR}
              fill={color}
              opacity={0.08 + p.intensity * 0.14}
              filter="url(#halo-blur)"
            />
          );
        })}

        {/* ── Dot layer (sharp markers) ── */}
        {projected.map((p, i) => {
          const color = p.type === 'competitor'
            ? CATEGORY_COLOR.competitor
            : CATEGORY_COLOR[p.categoryId] ?? '#818cf8';
          // Dot size: 3–8px scaled by intensity
          const r = 3 + p.intensity * 5;
          return (
            <circle
              key={`dot-${i}`}
              cx={p.x} cy={p.y}
              r={r}
              fill={color}
              opacity={0.55 + p.intensity * 0.45}
              filter="url(#dot-glow)"
            />
          );
        })}

        {/* ── Subject property (center) ── */}
        {/* Outer pulse ring */}
        <circle
          cx={subjectXY.x} cy={subjectXY.y}
          r={14}
          fill="none"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth="1"
        />
        {/* Glow fill */}
        <circle
          cx={subjectXY.x} cy={subjectXY.y}
          r={8}
          fill="white"
          opacity={0.15}
          filter="url(#subject-glow)"
        />
        {/* Solid dot */}
        <circle
          cx={subjectXY.x} cy={subjectXY.y}
          r={5}
          fill="white"
          opacity={0.95}
        />

        {/* ── Legend ── */}
        <g transform={`translate(${SVG_W - 124}, ${SVG_H - 72})`}>
          <rect x={0} y={0} width={118} height={62} rx={6} fill="rgba(15,20,30,0.85)" />
          {/* Magnet */}
          <circle cx={12} cy={16} r={4} fill="#818cf8" opacity={0.8} />
          <text x={20} y={20} fill="rgba(148,163,184,0.8)" fontSize="14" fontFamily="inherit">{c.legendMagnets}</text>
          {/* Competitor */}
          <circle cx={12} cy={36} r={4} fill="#f87171" opacity={0.8} />
          <text x={20} y={40} fill="rgba(148,163,184,0.8)" fontSize="14" fontFamily="inherit">{c.legendCompetitors}</text>
          {/* Subject */}
          <circle cx={12} cy={54} r={3} fill="white" opacity={0.9} />
          <text x={20} y={58} fill="rgba(148,163,184,0.8)" fontSize="14" fontFamily="inherit">{c.legendSubject}</text>
        </g>
      </svg>

      {/* Caption */}
      <div className="px-4 py-2.5 space-y-1">
        <p className="text-[18px] text-slate-500 leading-snug">
          {c.heatmapCaption}
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span className="text-[17px] text-slate-700">
            {c.heatmapCounts(
              heatmapPoints.filter(p => p.type === 'magnet').length,
              heatmapPoints.filter(p => p.type === 'competitor').length,
            )}
          </span>
          <span className="text-[17px] text-slate-600">
            {c.zoneActivityLine(footTraffic.zoneActivity, footTraffic.flowStability)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Address Input ─────────────────────────────────────────────────────────────

function AddressInput({
  onSelect,
  onClear,
  onDraftChange,
  disabled,
  locale,
  c,
}: {
  onSelect: (addr: SelectedAddress) => void;
  onClear: () => void;
  onDraftChange?: (draft: string) => void;
  disabled: boolean;
  locale: LocDemoLocale;
  c: (typeof LOC_COPY)['en'];
}) {
  const listboxId = useId();
  const recentListboxId = useId();
  const [text, setText] = useState('');
  const [locked, setLocked] = useState(false);
  const [lockedValue, setLockedValue] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [fetching, setFetching] = useState(false);
  const [resolvingPick, setResolvingPick] = useState(false);
  const [resolveFailed, setResolveFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [recentOpen, setRecentOpen] = useState(false);
  const [recentItems, setRecentItems] = useState<string[]>([]);
  const [recentActiveIdx, setRecentActiveIdx] = useState(-1);
  const [suggestStatus, setSuggestStatus] = useState<SuggestStatus>('idle');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestAbortRef = useRef<AbortController | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const geoRef = useRef<{ lat: number; lon: number } | null>(null);

  useEffect(() => () => {
    suggestAbortRef.current?.abort();
  }, []);

  // Best-effort one-shot geolocation for RU autocomplete viewport bias.
  // Silently no-ops if unsupported, denied, or non-RU. Never blocks suggest.
  useEffect(() => {
    if (locale !== 'ru') return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      pos => {
        if (cancelled) return;
        const { latitude, longitude } = pos.coords;
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          geoRef.current = { lat: latitude, lon: longitude };
        }
      },
      () => {
        /* permission denied or timeout — silent fallback to other hints */
      },
      { enableHighAccuracy: false, timeout: 4_000, maximumAge: 600_000 },
    );
    return () => {
      cancelled = true;
    };
  }, [locale]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setText(val);
    onDraftChange?.(val);
    setActiveIdx(-1);
    setRecentActiveIdx(-1);
    setResolveFailed(false);
    if (val.trim().length >= 2) setRecentOpen(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (val.trim().length >= 2) {
      setFetching(true);
      suggestAbortRef.current?.abort();
      const ac = new AbortController();
      suggestAbortRef.current = ac;
      debounceRef.current = setTimeout(async () => {
        try {
          const hint = locale === 'ru' ? resolveCityHint(geoRef.current) : undefined;
          const result = await fetchAddressSuggestions(locale, val, ac.signal, hint);
          if (suggestAbortRef.current !== ac) return;
          setSuggestions(result.suggestions);
          setSuggestStatus(result.status);
          setOpen(result.suggestions.length > 0);
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') return;
          console.warn('[location-demo] addressSuggest unexpected_error', {
            message: err instanceof Error ? err.message : String(err),
          });
          if (suggestAbortRef.current !== ac) return;
          setSuggestions([]);
          setSuggestStatus('error');
          setOpen(false);
        } finally {
          if (suggestAbortRef.current === ac) setFetching(false);
        }
      }, 280);
    } else {
      suggestAbortRef.current?.abort();
      suggestAbortRef.current = null;
      setSuggestions([]);
      setOpen(false);
      setSuggestStatus('idle');
      setFetching(false);
    }
  }

  function openRecentPanel() {
    const items = readRecentAddressesFromStorage(typeof window !== 'undefined' ? window.localStorage : undefined);
    setRecentItems(items);
    setRecentActiveIdx(-1);
    setRecentOpen(items.length > 0);
  }

  function pickRecent(addr: string) {
    setText(addr);
    onDraftChange?.(addr);
    setRecentOpen(false);
    setRecentActiveIdx(-1);
    setOpen(false);
    setActiveIdx(-1);
  }

  async function pick(s: Suggestion) {
    if (resolvingPick) return;

    const doSelect = (lat: number, lon: number) => {
      setLocked(true);
      setLockedValue(s.value);
      setText('');
      onDraftChange?.('');
      setSuggestions([]);
      setOpen(false);
      setRecentOpen(false);
      setSuggestStatus('idle');
      setResolveFailed(false);
      console.info('[location-demo] addressPick', {
        value: truncateForLog(s.value, 64),
        source: s.lat != null && s.lon != null ? 'inline_coords' : 'resolved',
      });
      if (locale === 'ru') rememberSelectedCity(s.value);
      rememberRecentAddress(s.value);
      onSelect({ value: s.value, lat, lon });
    };

    if (
      s.lat != null &&
      s.lon != null &&
      String(s.lat).trim() !== '' &&
      String(s.lon).trim() !== ''
    ) {
      const lat = parseFloat(String(s.lat));
      const lon = parseFloat(String(s.lon));
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        doSelect(lat, lon);
        return;
      }
    }

    setResolvingPick(true);
    setResolveFailed(false);
    console.info('[location-demo] addressResolve request_start', {
      value: truncateForLog(s.value, 64),
      hasPlaceId: Boolean(s.placeId),
      hasTwogisId: Boolean(s.twogisItemId),
    });
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
      const res = await fetch('/api/address-resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          locale,
          suggestion: {
            value: s.value,
            lat: s.lat,
            lon: s.lon,
            placeId: s.placeId,
            twogisItemId: s.twogisItemId,
          },
        }),
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = (await res.json()) as { lat?: unknown; lon?: unknown };
        if (typeof data.lat === 'number' && typeof data.lon === 'number') {
          console.info('[location-demo] addressResolve ok', { lat: data.lat, lon: data.lon });
          doSelect(data.lat, data.lon);
          return;
        }
      }
      console.warn('[location-demo] addressResolve failed', { httpStatus: res.status });
      setResolveFailed(true);
    } catch {
      console.warn('[location-demo] addressResolve network_error');
      setResolveFailed(true);
    } finally {
      setResolvingPick(false);
    }
  }

  function clear() {
    setLocked(false);
    setLockedValue('');
    setText('');
    onDraftChange?.('');
    setSuggestions([]);
    setOpen(false);
    setRecentOpen(false);
    setActiveIdx(-1);
    setRecentActiveIdx(-1);
    setSuggestStatus('idle');
    setResolveFailed(false);
    onClear();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const showRecentPanel =
      !locked &&
      recentOpen &&
      !open &&
      recentItems.length > 0 &&
      text.trim().length < 2;

    if (open && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx(i => Math.min(i + 1, suggestions.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && activeIdx >= 0) {
        e.preventDefault();
        void pick(suggestions[activeIdx]);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
      return;
    }

    if (showRecentPanel) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setRecentActiveIdx(i => Math.min(i + 1, recentItems.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setRecentActiveIdx(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && recentActiveIdx >= 0) {
        e.preventDefault();
        pickRecent(recentItems[recentActiveIdx]);
      } else if (e.key === 'Escape') {
        setRecentOpen(false);
      }
    }
  }

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setRecentOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={wrapRef} className="relative">
      {locked && (
        <div className="flex items-center gap-1.5 mb-2">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
            <path d="M1.5 5.5L4.5 8.5L9.5 2.5" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-[10px] font-semibold text-emerald-500 uppercase tracking-[0.18em]">{c.addressLocked}</span>
        </div>
      )}
      <div className="relative">
        <input
          type="text"
          value={locked ? lockedValue : text}
          onChange={locked ? () => undefined : handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (!locked) openRecentPanel();
          }}
          placeholder={c.addressPlaceholder}
          disabled={disabled || resolvingPick}
          readOnly={locked}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open || (!locked && recentOpen && recentItems.length > 0 && text.trim().length < 2)}
          aria-haspopup="listbox"
          aria-controls={
            open
              ? listboxId
              : (!locked && recentOpen && recentItems.length > 0 && text.trim().length < 2 ? recentListboxId : undefined)
          }
          aria-activedescendant={
            open && activeIdx >= 0
              ? `${listboxId}-opt-${activeIdx}`
              : (!open && recentOpen && recentActiveIdx >= 0 ? `${recentListboxId}-opt-${recentActiveIdx}` : undefined)
          }
          className={`w-full py-4 rounded-xl bg-slate-800/80 border text-base focus:outline-none focus:ring-2 transition-all disabled:opacity-50 ${
            locked
              ? 'border-emerald-700/60 focus:ring-emerald-500/20 pl-10 pr-12 text-emerald-300 cursor-default'
              : 'border-slate-700 text-white placeholder-slate-500 focus:ring-white/15 focus:border-slate-600 px-5 pr-10'
          }`}
        />
        {locked && (
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
              <circle cx="7.5" cy="7.5" r="7" stroke="#34d399" strokeOpacity="0.35" />
              <path d="M4.5 7.5L6.5 9.5L10.5 5.5" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        )}
        {locked && !disabled && (
          <button
            type="button"
            onClick={clear}
            aria-label={c.changeAddressAria}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-full text-slate-500 hover:text-slate-300 hover:bg-slate-700/60 transition-all"
          >
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="1" y1="1" x2="8" y2="8" />
              <line x1="8" y1="1" x2="1" y2="8" />
            </svg>
          </button>
        )}
        {!locked && (fetching || resolvingPick) && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-slate-600 border-t-slate-300 rounded-full animate-spin pointer-events-none" />
        )}
      </div>

      {open && suggestions.length > 0 && !locked && (
        <ul
          role="listbox"
          id={listboxId}
          className="absolute z-50 w-full mt-1 rounded-xl border border-slate-700 bg-slate-900/95 backdrop-blur shadow-2xl overflow-y-auto"
          style={{ maxHeight: 260 }}
        >
          {suggestions.map((s, i) => (
            <li
              key={i}
              role="option"
              id={`${listboxId}-opt-${i}`}
              aria-selected={activeIdx === i}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseDown={e => { e.preventDefault(); void pick(s); }}
              className={`px-4 py-3 cursor-pointer text-sm leading-snug transition-colors ${
                activeIdx === i ? 'bg-slate-700/80 text-white' : 'text-slate-300 hover:bg-slate-800/80'
              }`}
            >
              {s.value}
            </li>
          ))}
        </ul>
      )}

      {!locked && recentOpen && !open && recentItems.length > 0 && text.trim().length < 2 && (
        <ul
          role="listbox"
          id={recentListboxId}
          aria-label={locale === 'ru' ? 'Недавние адреса' : 'Recent addresses'}
          className="absolute z-50 w-full mt-1 rounded-xl border border-slate-700 bg-slate-900/95 backdrop-blur shadow-2xl overflow-y-auto"
          style={{ maxHeight: 260 }}
        >
          {recentItems.map((addr, i) => (
            <li
              key={`${addr}-${i}`}
              role="option"
              id={`${recentListboxId}-opt-${i}`}
              aria-selected={recentActiveIdx === i}
              onMouseEnter={() => setRecentActiveIdx(i)}
              onMouseDown={e => {
                e.preventDefault();
                pickRecent(addr);
              }}
              className={`px-4 py-3 cursor-pointer text-sm leading-snug transition-colors ${
                recentActiveIdx === i ? 'bg-slate-700/80 text-white' : 'text-slate-300 hover:bg-slate-800/80'
              }`}
            >
              {addr}
            </li>
          ))}
        </ul>
      )}

      {!locked && !open && !fetching && !resolvingPick && text.trim().length >= 2 && (
        suggestStatus === 'no_results' ? (
          <p className="mt-1.5 px-1 text-xs text-slate-500">{c.addrNotFound}</p>
        ) : (suggestStatus === 'no_key' || suggestStatus === 'error') ? (
          <p className="mt-1.5 px-1 text-xs text-slate-500">{c.suggestUnavailable}</p>
        ) : null
      )}
      {resolveFailed && !locked && (
        <p className="mt-1.5 px-1 text-xs text-rose-400/90" role="alert">{c.addrNotFound}</p>
      )}
    </div>
  );
}

// ── Evergreen ring SVG ────────────────────────────────────────────────────────

const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;
const RING_VB = 120;

function EvergreenRing({
  index,
  band,
  animated,
  copy,
}: {
  index: number;
  band: Band;
  animated: boolean;
  copy: (typeof LOC_COPY)['en'];
}) {
  const fill = animated ? (index / 100) * RING_C : 0;
  const cx = RING_VB / 2;
  return (
    <svg width={RING_VB} height={RING_VB} viewBox={`0 0 ${RING_VB} ${RING_VB}`} className="shrink-0" aria-hidden="true">
      <circle cx={cx} cy={cx} r={RING_R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
      <circle
        cx={cx} cy={cx} r={RING_R}
        fill="none"
        stroke={band.stroke}
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${fill} ${RING_C}`}
        transform={`rotate(-90 ${cx} ${cx})`}
        style={{ transition: animated ? 'stroke-dasharray 1.0s cubic-bezier(0.4,0,0.2,1)' : 'none' }}
      />
      <text x={cx} y={cx - 8} textAnchor="middle" fill="white" fontSize="38" fontWeight="700" fontFamily="inherit">
        {index > 0 ? index : '—'}
      </text>
      <text x={cx} y={cx + 14} textAnchor="middle" fill="rgb(100,116,139)" fontSize="15" fontFamily="inherit">
        {copy.evergreenLine1}
      </text>
      <text x={cx} y={cx + 34} textAnchor="middle" fill="rgb(100,116,139)" fontSize="15" fontFamily="inherit">
        {copy.evergreenLine2}
      </text>
    </svg>
  );
}

// ── Magnet filtering + deduplication ─────────────────────────────────────────

const STREET_NOISE_KEYWORDS = [
  'улица', ' ул.', ' ул ', ' ул,',
  'проспект', ' пр.', ' пр ',
  'набережная', 'наб.',
  'переулок', ' пер.', ' пер ',
  'бульвар', 'б-р',
  'шоссе', ' ш.',
  'проезд', 'площадь', ' пл.',
  'аллея', 'тупик',
  'street', ' st.', ' st ', ' st,',
  'avenue', ' ave.', ' ave ',
  'road', ' rd.', ' rd ',
  'boulevard', ' blvd',
  'lane', ' ln.',
  'drive', ' dr.',
  'way', 'place', 'pl.',
];

function isStreetNoise(name: string): boolean {
  const lower = name.toLowerCase();
  return STREET_NOISE_KEYWORDS.some(kw => lower.includes(kw));
}

function normalizeMetroName(name: string): string {
  return name
    .replace(/\s*(входа?|выходы?|выхода?)\s*[№#]?\s*\d*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Categories that are weak lifestyle signals — should not dominate the visible list.
 * These are capped so strong/medium evergreen magnets stay in front.
 * Note: food items upgraded to 'medium' by the cluster bonus are not capped.
 */
const WEAK_CATEGORY_DISPLAY_CAP: Readonly<Record<string, number>> = {
  food:            2,
  shopping_local:  1,
  education_local: 1,
};

function getFilteredMagnets(magnets: MagnetItem[], limit: number): MagnetItem[] {
  const filtered = magnets.filter(m => !isStreetNoise(m.name));

  const metroByStation = new Map<string, MagnetItem>();
  const nonMetro: MagnetItem[] = [];

  for (const m of filtered) {
    if (m.categoryId === 'metro') {
      const key = normalizeMetroName(m.name);
      const existing = metroByStation.get(key);
      if (!existing || m.distance < existing.distance) {
        metroByStation.set(key, { ...m, name: key || m.name });
      }
    } else {
      nonMetro.push(m);
    }
  }

  const all = [...metroByStation.values(), ...nonMetro];
  all.sort((a, b) => b.attractionScore - a.attractionScore);

  // Apply weak-category display cap: food/local/schools should not crowd out
  // strong evergreen magnets. Items that were upgraded to 'medium' (e.g. food
  // cluster bonus) are exempt — they earned their slot through scoring.
  const weakCounts: Record<string, number> = {};
  const capped = all.filter(m => {
    const cap = WEAK_CATEGORY_DISPLAY_CAP[m.categoryId];
    if (cap === undefined) return true;              // not a capped category
    if (m.strengthClass !== 'weak') return true;     // cluster-upgraded — keep it
    const seen = weakCounts[m.categoryId] ?? 0;
    if (seen >= cap) return false;
    weakCounts[m.categoryId] = seen + 1;
    return true;
  });

  return capped.slice(0, limit);
}

// ── Score factor generator ────────────────────────────────────────────────────

function generateScoreFactors(analysis: LocationAnalysis, locale: LocDemoLocale): string[] {
  const { magnets, magnetCountByCategory, gravityExplanation, demandType, accessibilityStops } = analysis;
  const factors: string[] = [];

  // Transit
  const hasMetro = (magnetCountByCategory.metro ?? 0) > 0;
  const transitStops = accessibilityStops?.length ?? 0;
  if (hasMetro) {
    factors.push(locale === 'ru' ? 'Метро в шаговой доступности' : 'Metro station within walking distance');
  } else if (transitStops === 0 && !hasMetro) {
    factors.push(locale === 'ru' ? 'Слабая транспортная связность' : 'Weak transport connectivity');
  } else {
    factors.push(locale === 'ru' ? 'Базовый общественный транспорт в зоне' : 'Basic transit options in the area');
  }

  // Attractions
  const attractionCount = magnetCountByCategory.attraction ?? 0;
  if (attractionCount >= 3) {
    factors.push(locale === 'ru' ? 'Несколько достопримечательностей поблизости' : 'Multiple nearby attractions drive tourist demand');
  } else if (attractionCount === 0) {
    factors.push(locale === 'ru' ? 'Рядом мало достопримечательностей' : 'Limited nearby attractions');
  }

  // Demand type / seasonality
  if (demandType === 'tourism-led') {
    factors.push(locale === 'ru' ? 'Туристический спрос — сезонные пики трафика' : 'Seasonal traffic patterns — peaks in tourist season');
  } else if (demandType === 'business-led') {
    factors.push(locale === 'ru' ? 'Деловой спрос — стабильные бронирования круглый год' : 'Business-driven demand — stable year-round bookings');
  } else if (demandType === 'transport-led') {
    factors.push(locale === 'ru' ? 'Транзитный трафик — временный профиль гостей' : 'Transit-driven footfall — transient guest profile');
  } else {
    factors.push(locale === 'ru' ? 'Смешанный спрос — сбалансированный профиль бронирований' : 'Mixed demand — balanced booking profile');
  }

  // Competitor pressure
  if (gravityExplanation.competitorPressureLevel === 'high') {
    factors.push(locale === 'ru' ? 'Высокая конкуренция — важна упаковка и дифференциация' : 'High local competition — pricing and positioning critical');
  } else if (gravityExplanation.competitorPressureLevel === 'low') {
    factors.push(locale === 'ru' ? 'Низкая конкуренция — рыночная ниша в этой зоне' : 'Low competition — market gap available in this zone');
  }

  // Magnet density
  if (magnets.length >= 8) {
    factors.push(locale === 'ru' ? 'Насыщенная инфраструктура обеспечивает стабильный трафик' : 'Dense amenity mix supports consistent footfall');
  } else if (magnets.length <= 2) {
    factors.push(locale === 'ru' ? 'Мало магнитов спроса поблизости' : 'Low tourist demand — few demand generators nearby');
  }

  return factors.slice(0, 5);
}

// ── Public-copy sanitiser (RU) ────────────────────────────────────────────────
// Maps internal cap/sanity/scoring vocabulary to business-friendly wording at
// the render layer. The canonical source strings live in
// `src/lib/location/rules/**` and `location-score.ts` and stay untouched.
// ── Competitor Breakdown Block ────────────────────────────────────────────────

function CompetitorBreakdownBlock({
  analysis,
  locale,
  suppressIncomeHints,
}: {
  analysis: LocationAnalysis;
  locale: LocDemoLocale;
  suppressIncomeHints?: boolean;
}) {
  const { competitors, gravityExplanation, locationScore } = analysis;
  const isRu = locale === 'ru';

  if (competitors.length === 0) return null;

  const top = [...competitors].sort((a, b) => a.distance - b.distance).slice(0, 5);
  const level = gravityExplanation.competitorPressureLevel;
  const supplyScore = locationScore?.breakdown.supply_score;

  function inferType(name: string): string {
    const n = name.toLowerCase();
    if (/хостел|hostel/.test(n)) return isRu ? 'хостел' : 'hostel';
    if (/апарт|apart/.test(n)) return isRu ? 'апартаменты' : 'apartments';
    if (/гостин|hotel|отель/.test(n)) return isRu ? 'гостиница' : 'hotel';
    if (/inn|инн|мини/.test(n)) return isRu ? 'мини-отель' : 'mini-hotel';
    return isRu ? 'посуточная аренда' : 'short-term rental';
  }

  function fmtDist(m: number): string {
    return m < 1000
      ? `${Math.round(m / 10) * 10} ${isRu ? 'м' : 'm'}`
      : `${(m / 1000).toFixed(1)} ${isRu ? 'км' : 'km'}`;
  }

  const levelColor =
    level === 'high'   ? 'text-rose-400'
    : level === 'medium' ? 'text-amber-400'
    : 'text-emerald-400';

  const levelLabel = isRu
    ? (level === 'high' ? 'Высокая конкуренция' : level === 'medium' ? 'Умеренная конкуренция' : 'Низкая конкуренция')
    : (level === 'high' ? 'High competition'    : level === 'medium' ? 'Moderate competition'  : 'Low competition');

  // Summary lines: what drives this level and what it means
  const summaryLines: string[] = [];
  if (isRu) {
    if (level === 'high') {
      summaryLines.push(`${competitors.length} конкурентов в зоне — давление на ставку и загрузку.`);
      summaryLines.push(
        supplyScore !== undefined && supplyScore < 45
          ? 'Свободной ниши нет — критичны упаковка и дифференциация.'
          : 'Нужна чёткая позиция: рейтинг, описание, цена.',
      );
    } else if (level === 'medium') {
      summaryLines.push(`${competitors.length} конкурентов в зоне — ниша частично открыта.`);
      summaryLines.push('При качественной упаковке можно занять устойчивую позицию.');
    } else {
      const cnt = competitors.length;
      summaryLines.push(
        `${cnt} конкурент${cnt === 1 ? '' : cnt <= 4 ? 'а' : 'ов'} в зоне — рынок слабо насыщен.`,
      );
      summaryLines.push('Ниша свободна: проще войти и удерживать ставку.');
    }
  } else {
    if (level === 'high') {
      summaryLines.push(`${competitors.length} competitors nearby — pressure on rates and occupancy.`);
      summaryLines.push('Strong positioning and reviews are critical to hold rates.');
    } else if (level === 'medium') {
      summaryLines.push(`${competitors.length} competitors nearby — partial market gap available.`);
      summaryLines.push('Quality listings can establish a stable position.');
    } else {
      summaryLines.push(`${competitors.length} competitor${competitors.length === 1 ? '' : 's'} nearby — low market saturation.`);
      summaryLines.push('Market gap available — easier to enter and hold rates.');
    }
  }

  // Verdict linkage note
  const verdictNote: string | null =
    level === 'high'
      ? (isRu
          ? (suppressIncomeHints
              ? (supplyScore !== undefined && supplyScore < 45
                  ? 'Сильное давление конкурентов — нужна заметная упаковка и позиционирование.'
                  : 'Конкурентов много — сложнее удерживать загрузку без упаковки.')
              : (supplyScore !== undefined && supplyScore < 45
                  ? 'Конкуренция ограничивает доходный потенциал объекта.'
                  : 'Конкуренты снижают прогнозируемую загрузку.'))
          : 'Competition limits income potential.')
      : level === 'low'
        ? (isRu
            ? (suppressIncomeHints ? 'Конкурентов немного — проще занять нишу.' : 'Конкурентная среда поддерживает доходный потенциал.')
            : 'Low competition supports income potential.')
        : null;

  return (
    <div className="px-5 py-4 border-b border-slate-800/40">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h3 className="text-[20px] md:text-[22px] font-semibold text-slate-100 leading-tight">
          {isRu ? 'Конкурентная среда' : 'Competitive landscape'}
        </h3>
        <span className={`text-[13px] font-medium ${levelColor}`}>{levelLabel}</span>
      </div>

      {/* Summary */}
      <div className="mb-3 space-y-0.5">
        {summaryLines.map((line, i) => (
          <p key={i} className="text-[13px] text-slate-400 leading-snug">{line}</p>
        ))}
      </div>

      {/* Competitor list */}
      <div className="space-y-2">
        {top.map((comp, i) => (
          <div key={i} className="flex items-center justify-between text-[13px]">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${
                comp.distance < 300 ? 'bg-rose-400'
                : comp.distance < 600 ? 'bg-amber-400/80'
                : 'bg-slate-600'
              }`} />
              <span className="text-slate-300 truncate">{comp.name || (isRu ? `Объект #${i + 1}` : `Unit #${i + 1}`)}</span>
              <span className="text-slate-700">·</span>
              <span className="text-slate-500 shrink-0">{inferType(comp.name)}</span>
            </div>
            <span className="text-slate-500 shrink-0 ml-2 tabular-nums">{fmtDist(comp.distance)}</span>
          </div>
        ))}
      </div>

      {/* Verdict linkage */}
      {verdictNote && (
        <p className={`mt-3 pt-2 border-t border-slate-800/30 text-[13px] leading-snug ${
          level === 'high' ? 'text-amber-400/80' : 'text-emerald-400/80'
        }`}>
          {level === 'high' ? '↓ ' : '↑ '}{verdictNote}
        </p>
      )}
    </div>
  );
}

function isEnvironmentMapCoverageFootnote(line: string): boolean {
  const l = line.toLowerCase();
  return (
    l.includes('coverage confidence') ||
    l.includes('map coverage') ||
    (l.includes('confidence') && (l.includes('indicative') || l.includes('edge cases'))) ||
    l.includes('уверенност') ||
    l.includes('полнота карты') ||
    l.includes('ориентировочн')
  );
}

function envConcernStyles(level: NeighborhoodEnvironmentConcernLevel): { bar: string; badge: string } {
  switch (level) {
    case 'low':
      return { bar: 'bg-emerald-500/80', badge: 'text-emerald-400/90 border-emerald-500/35' };
    case 'moderate':
      return { bar: 'bg-amber-500/85', badge: 'text-amber-300/95 border-amber-500/35' };
    case 'elevated':
      return { bar: 'bg-orange-500/85', badge: 'text-orange-300/95 border-orange-500/35' };
    case 'high':
      return { bar: 'bg-rose-500/85', badge: 'text-rose-300/95 border-rose-500/35' };
    default:
      return { bar: 'bg-slate-500', badge: 'text-slate-400 border-slate-600/40' };
  }
}

function NeighborhoodEnvironmentPanel({
  analysis,
  locale,
  c,
  hideAmbientFinePrint,
}: {
  analysis: LocationAnalysis;
  locale: LocDemoLocale;
  c: (typeof LOC_COPY)['en'];
  hideAmbientFinePrint?: boolean;
}) {
  const ne = analysis.neighborhoodEnvironment;
  if (!ne) return null;
  const reasons = locale === 'ru' ? ne.reasonsRu : ne.reasonsEn;
  const label = locale === 'ru' ? ne.concernLabelRu : ne.concernLabelEn;
  const narrative = locale === 'ru' ? ne.environmentNarrativeRu : ne.environmentNarrativeEn;
  const styles = envConcernStyles(ne.concernLevel);
  const score = ne.environmentalFrictionScore;

  const coverageNotes = reasons.filter(isEnvironmentMapCoverageFootnote);
  const substantiveReasonsRaw = reasons.filter(line => !isEnvironmentMapCoverageFootnote(line));
  const substantiveReasons = locale === 'ru'
    ? sanitizeRuFactorList(substantiveReasonsRaw)
    : substantiveReasonsRaw;
  const keyReasons = substantiveReasons.slice(0, 4);
  const coverageLine = coverageNotes.join(' ');

  const title =
    locale === 'ru'
      ? 'Среда вокруг объекта'
      : c.envBlockTitle;

  return (
    <div className="px-5 py-4 border-b border-slate-800/40 bg-slate-950/40">
      <h3 className="text-[20px] md:text-[22px] font-semibold text-slate-100 mb-2">
        {title}
      </h3>
      {!hideAmbientFinePrint ? (
        <p className="text-[14px] text-slate-500 leading-snug mb-3">
          {locale === 'ru' ? 'Короткая оценка окружения по карте и сигналам района.' : c.envLayerLead}
        </p>
      ) : (
        <p className="text-[15px] text-slate-400 leading-snug mb-3 font-medium">
          {locale === 'ru'
            ? 'Окружение по карте и сигналам района.'
            : c.envLayerLead}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3 mb-2">
        <div>
          {!hideAmbientFinePrint ? (
            <p className="text-[13px] text-slate-500 mb-0.5">{c.envLayerScoreLabel}</p>
          ) : (
            <p className="text-[14px] text-slate-400 mb-0.5 font-medium">{c.envLayerScoreLabel}</p>
          )}
          <p className="text-[24px] font-bold tabular-nums text-slate-100 leading-none">{score}</p>
        </div>
        <span
          className={`inline-flex items-center rounded-lg border px-2.5 py-1 text-[13px] font-semibold ${styles.badge}`}
        >
          {label}
        </span>
        {!hideAmbientFinePrint ? (
          <span className="text-[12px] text-slate-600 ml-auto max-w-[min(100%,220px)] text-right leading-snug">
            {c.envConfidence(ne.confidence)}
          </span>
        ) : null}
      </div>
      <div className="h-1.5 w-full rounded-full bg-slate-800/80 overflow-hidden mb-3">
        <div className={`h-full rounded-full transition-all ${styles.bar}`} style={{ width: `${score}%` }} />
      </div>
      {keyReasons.length > 0 ? (
        <ul className="space-y-1.5 mb-3">
          {keyReasons.map((line, i) => (
            <li key={i} className="flex items-start gap-2 text-[14px] text-slate-400 leading-snug">
              <span className="mt-[6px] shrink-0 w-1.5 h-1.5 rounded-full bg-sky-500/70" />
              {line}
            </li>
          ))}
        </ul>
      ) : null}
      {!hideAmbientFinePrint && coverageLine ? (
        <p className="text-[12px] text-slate-600 leading-snug mb-3">{coverageLine}</p>
      ) : null}
      {narrative ? (
        <p className="text-[13px] text-slate-500 leading-snug border-t border-slate-800/35 pt-3">
          {narrative}
        </p>
      ) : null}
    </div>
  );
}

// ── ASI results panel ─────────────────────────────────────────────────────────

function ASIPanel({
  analysis,
  address,
  animated,
  meta,
  locale,
  c,
  mode,
}: {
  analysis: LocationAnalysis;
  address: string;
  animated: boolean;
  meta: AnalysisMeta | null;
  locale: LocDemoLocale;
  c: (typeof LOC_COPY)['en'];
  mode: LocationAnalysisMode;
}) {
  const router = useRouter();
  const {
    magnets, evergreenIndex, gravityExplanation, competitors, magnetCountByCategory,
  } = analysis;
  const footTraffic = footTrafficForLocale(analysis.footTraffic, locale);
  const conclusion =
    locale === 'ru'
      ? generateConclusion(
          evergreenIndex,
          magnets,
          competitors,
          magnetCountByCategory,
          gravityExplanation,
          'ru',
          analysis.audienceAnalysis,
        )
      : analysis.conclusion;
  const band = getBand(evergreenIndex, analysis.audienceAnalysis?.primaryAudience);
  // Use the engine's recommendation when available; fallback aligns with getBand thresholds.
  const strategy: 'mid_term' | 'hybrid' | 'short_term' =
    analysis.locationScore?.recommended_strategy ??
    (evergreenIndex >= 70 ? 'short_term' : evergreenIndex >= 45 ? 'hybrid' : 'mid_term');
  const strategyPoints =
    strategy === 'mid_term' ? c.strategyMidTerm
    : strategy === 'hybrid' ? c.strategyHybrid
    : c.strategyShortTerm;
  const [visible, setVisible] = useState(false);
  const [magnetExpanded, setMagnetExpanded] = useState(false);
  const [fullReportBusy, setFullReportBusy] = useState(false);
  const [fullReportErr, setFullReportErr] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(t);
  }, []);

  const hasMagnets = magnets.length > 0;
  const { primaryAudience } = analysis.audienceAnalysis ?? {};
  const audienceLabelRu = primaryAudience === 'BUSINESS' ? 'Деловой' : primaryAudience === 'TOURIST' ? 'Туристический' : '—';
  const audienceLabelEn = primaryAudience === 'BUSINESS' ? 'Business' : primaryAudience === 'TOURIST' ? 'Tourist' : '—';
  const incomeRange = (() => {
    const income = analysis.locationScore?.estimated_monthly_income;
    if (income) {
      const val = income[strategy];
      if (locale === 'ru') {
        const lo = Math.round(val * 0.85 / 5000) * 5000;
        const hi = Math.round(val * 1.15 / 5000) * 5000;
        return `${lo.toLocaleString('ru-RU')} – ${hi.toLocaleString('ru-RU')} ₽`;
      }
      // Convert RUB to approximate USD (×0.011) for EN locale display
      const loUsd = Math.round(val * 0.85 * 0.011 / 100) * 100;
      const hiUsd = Math.round(val * 1.15 * 0.011 / 100) * 100;
      return `$${loUsd.toLocaleString()} – $${hiUsd.toLocaleString()}`;
    }
    // Fallback when locationScore is unavailable
    if (locale === 'ru') {
      return strategy === 'mid_term' ? '80 000 – 130 000 ₽'
        : strategy === 'hybrid'     ? '120 000 – 200 000 ₽'
        :                             '160 000 – 300 000 ₽';
    }
    return strategy === 'mid_term' ? '$900 – $1 500'
      : strategy === 'hybrid'      ? '$1 300 – $2 200'
      :                              '$1 800 – $3 300';
  })();
  const isRuResidentialDemo = locale === 'ru' && mode === 'residential';
  const ruResidentialDemandHeadlineRu = (dt: DemandType): string => {
    switch (dt) {
      case 'tourism-led':
        return 'Туристический спрос в зоне';
      case 'business-led':
        return 'Спрос от делового и офисного трафика';
      case 'transport-led':
        return 'Транзитный и транспортно-связанный спрос';
      default:
        return 'Смешанный профиль спроса';
    }
  };
  const serverSanity = (meta as AnalysisMetaWithDemoSanity | null)?.demoSanity;
  const sanity = isRuResidentialDemo ? (serverSanity ?? applyResidentialDemoSanity(analysis)) : null;
  const aboveFoldReasons = (() => {
    const ls = analysis.locationScore;
    const specificFactors = [
      ...(ls?.top_positive_factors ?? []),
      ...(ls?.top_negative_factors ?? []),
    ];
    const factors = specificFactors.length > 0 ? specificFactors : generateScoreFactors(analysis, locale);
    const merged = sanity ? [...sanity.capReasonsRu, ...factors] : factors;
    const cleaned = isRuResidentialDemo ? normalizeRuDemoExplanationLines(merged, 5) : merged;

    return cleaned.slice(0, 2).map((factor) => {
      const normalized = factor.replace(/\s+/g, ' ').trim();
      return normalized.length > 86 ? `${normalized.slice(0, 83).trimEnd()}...` : normalized;
    });
  })();

  async function requestFullReportAsync() {
    if (fullReportBusy) return;
    setFullReportErr(null);
    setFullReportBusy(true);
    try {
      const res = await fetch('/api/location-full-report/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          address,
          locale,
          mode,
          delivery: { channel: 'dashboard', target: 'public' },
          // Monetization hook (MVP): UI can upgrade this to 'included' or 'paid_required' later.
          access_tier: 'unknown',
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.requestId) throw new Error(json?.error || 'request_failed');

      const requestId = String(json.requestId);

      // Kick off processing (do not block the UI on the long request).
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      fetch('/api/location-full-report/process', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId }),
        keepalive: true,
      });

      // Poll for completion; when done, open permalink.
      const pollStart = Date.now();
      const poll = async () => {
        const s = await fetch(`/api/location-full-report/request/${requestId}`, { cache: 'no-store' });
        const sj = await s.json().catch(() => ({}));
        if (!s.ok) return { status: 'failed' as const, error: sj?.error ?? 'status_failed' };
        return sj as { status?: string; reportId?: string; error?: string };
      };

      // First quick poll after a short delay, then keep polling.
      await new Promise<void>(resolve => setTimeout(resolve, 900));
      for (;;) {
        const st = await poll();
        if (st.status === 'completed' && st.reportId) {
          const reportId = String(st.reportId);
          router.push(buildLocationReportPermalink({ reportId, locale }));
          return;
        }
        if (st.status === 'failed') {
          throw new Error(st.error || 'processing_failed');
        }
        if (Date.now() - pollStart > 90_000) {
          throw new Error('timeout');
        }
        await new Promise<void>(resolve => setTimeout(resolve, 1500));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFullReportErr(msg);
    } finally {
      setFullReportBusy(false);
    }
  }

  function openStandaloneFullReportRu() {
    (async () => {
      const standalone = buildLocationStandaloneReport({
        address,
        inputAddress: address,
        analysis,
        verdict: conclusion || 'Итог: данных недостаточно для уверенного вывода.',
        reportMode: 'free',
      });

      try {
        const res = await fetch('/api/location-standalone-report', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ locale: 'ru', report: standalone }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.reportId) throw new Error(json?.error || 'create_failed');
        router.push(buildLocationReportPermalink({ reportId: String(json.reportId), locale: 'ru' }));
      } catch {
        router.push(LOCATION_REPORT_SAMPLE_PATH);
      }
    })();
  }

  const dashboardBullets: string[] = (() => {
    const ls = analysis.locationScore;
    const pos = ls?.top_positive_factors ?? [];
    const neg = ls?.top_negative_factors ?? [];
    const merged: string[] = [];
    for (const p of pos) {
      if (typeof p === 'string' && p.trim()) merged.push(p.trim());
      if (merged.length >= 4) break;
    }
    for (const n of neg) {
      if (merged.length >= 4) break;
      if (typeof n === 'string' && n.trim()) merged.push(n.trim());
    }
    const base = merged.length > 0 ? merged : generateScoreFactors(analysis, locale);
    const cleaned = isRuResidentialDemo ? normalizeRuDemoExplanationLines(base, 5) : base;
    return cleaned.slice(0, 2);
  })();

  return (
    <>
    <div
      className={`rounded-2xl border ${band.border} ${band.bg} overflow-hidden`}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(10px)',
        transition: 'opacity 0.4s ease, transform 0.4s ease',
      }}
    >
      {!isRuResidentialDemo && meta ? <AnalysisFreshnessStrip meta={meta} locale={locale} c={c} /> : null}
      {meta && !isRuResidentialDemo ? <ConfidenceWarningsStrip meta={meta} locale={locale} /> : null}
      {/* Main result dashboard — 3 columns on desktop */}
      <div className="p-5 md:p-6">
        <div className="grid md:grid-cols-3 gap-4 md:gap-5 items-stretch">

          {/* Left: Score / index */}
          <div className="rounded-2xl border border-slate-800/45 bg-slate-950/35 p-4 md:p-5">
            {!isRuResidentialDemo ? (
              <p className="text-[13px] text-slate-400 font-medium">
                {locale === 'ru' ? 'Индекс' : 'Index'}
              </p>
            ) : null}
            <div className={`flex items-end gap-3 ${isRuResidentialDemo ? '' : 'mt-2'}`}>
              <div className="leading-none">
                <span className={`text-[56px] md:text-[64px] font-extrabold tabular-nums ${band.textColor}`}>
                  {evergreenIndex}
                </span>
                <span className="ml-1 text-[18px] md:text-[20px] text-slate-500 font-semibold tabular-nums">/100</span>
              </div>
              <div className="ml-auto hidden lg:block">
                <EvergreenRing index={evergreenIndex} band={band} animated={animated} copy={c} />
              </div>
            </div>
            {dashboardBullets.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {dashboardBullets.map((line, i) => (
                  <li key={i} className={`flex items-start gap-2 leading-snug ${isRuResidentialDemo ? 'text-[15px] text-slate-200' : 'text-[14px] text-slate-300'}`}>
                    <span className="mt-[6px] shrink-0 w-1.5 h-1.5 rounded-full bg-slate-600" />
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Middle: demand profile (+ income outside RU residential demo) */}
          <div className="rounded-2xl border border-slate-800/45 bg-slate-950/35 p-4 md:p-5">
            {!isRuResidentialDemo ? (
              <p className="text-[13px] text-slate-400 font-medium">
                {locale === 'ru' ? 'Профиль спроса' : 'Demand profile'}
              </p>
            ) : null}
            {isRuResidentialDemo ? (
              <p className="mt-1 text-[22px] md:text-[26px] font-semibold text-slate-100 leading-snug">
                {ruResidentialDemandHeadlineRu(analysis.demandType)}
              </p>
            ) : (
              <>
                <p className="mt-2 text-[28px] md:text-[32px] font-bold text-slate-100 leading-tight">
                  {locale === 'ru'
                    ? 'Сегмент спроса'
                    : (mode === 'commercial' ? 'Commercial' : 'Residential')}
                  <span className="text-slate-700 font-semibold"> | </span>
                  <span className="text-slate-200">{locale === 'ru' ? audienceLabelRu : audienceLabelEn}</span>
                </p>
                <p className="mt-2 text-[22px] md:text-[24px] font-bold text-slate-100 leading-tight">
                  {incomeRange}
                </p>
                <p className="mt-1 text-[14px] text-slate-500 leading-snug">
                  {locale === 'ru' ? 'Доход — ориентир для сравнения локаций.' : c.incomeSuffix}
                </p>
              </>
            )}
          </div>

          {/* Right: Verdict + CTA */}
          <div className="rounded-2xl border border-slate-800/45 bg-slate-950/35 p-4 md:p-5 flex flex-col">
            {!isRuResidentialDemo ? (
              <p className="text-[13px] text-slate-400 font-medium">
                {locale === 'ru' ? 'Вердикт' : 'Verdict'}
              </p>
            ) : null}
            <p className={`${isRuResidentialDemo ? 'mt-1' : 'mt-2'} text-[28px] md:text-[32px] font-bold leading-tight ${band.textColor}`}>
              {band.label}
            </p>
            <div className="mt-4 space-y-2">
              <button
                type="button"
                onClick={requestFullReportAsync}
                disabled={fullReportBusy}
                className="w-full py-3 px-4 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:bg-indigo-500/60 text-white text-[14px] font-semibold transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
              >
                {locale === 'ru'
                  ? (fullReportBusy ? 'Готовим отчёт…' : 'Заказать отчёт')
                  : (fullReportBusy ? 'Generating…' : 'Request report')}
              </button>
              {locale === 'ru' ? (
                <button
                  type="button"
                  onClick={openStandaloneFullReportRu}
                  className="w-full py-3 px-4 rounded-xl bg-slate-900/40 hover:bg-slate-900/60 border border-slate-800/60 text-slate-100 text-[13px] font-semibold transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                >
                  Открыть демо‑permalink
                </button>
              ) : null}
              {fullReportErr ? (
                <p className="text-[12px] text-amber-400/90 leading-snug">
                  {locale === 'ru'
                    ? `Не удалось запустить отчёт: ${fullReportErr}`
                    : `Couldn’t start the report: ${fullReportErr}`}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>

    {/* ── Detail sections — below summary panel ── */}
    <div
      className="mt-4 rounded-2xl border border-slate-800/40 overflow-hidden"
      style={{
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.5s ease 0.15s',
      }}
    >
      <div className="px-5 py-4 border-b border-slate-800/40">
        {isRuResidentialDemo ? (
          <p className="text-[17px] md:text-[18px] font-medium text-slate-300 leading-snug">
            Краткая оценка локации. Подробный расчёт доступен в полном отчёте.
          </p>
        ) : (
          <p className="text-[14px] text-slate-500 leading-snug">
            {locale === 'ru'
              ? 'Демо‑результат — быстрый ориентир. Детали ниже объясняют факторы, конкуренцию и окружение.'
              : 'Demo result is a fast preview. Details below explain factors, competition, and environment.'}
          </p>
        )}
      </div>

      {/* Why this score? — uses locationScore factors when available, falls back to generic */}
      {(() => {
        const ls = analysis.locationScore;
        const rawPos = ls?.top_positive_factors ?? [];
        const rawNeg = ls?.top_negative_factors ?? [];

        const regionalRuExtras =
          locale === 'ru'
            ? [
              strategicHubFreeBriefRu(analysis.strategicTransportHubMagnets ?? []),
              specializedMedicalFreeBriefRu(analysis.magnets ?? []),
            ].filter((x): x is string => Boolean(x))
            : [];

        if (isRuResidentialDemo) {
          const rawGeneric =
            rawPos.length + rawNeg.length === 0 ? generateScoreFactors(analysis, locale) : [];
          const mergedRu = normalizeRuDemoExplanationLines(
            [...rawPos, ...rawNeg, ...rawGeneric, ...regionalRuExtras],
            5,
          );
          if (mergedRu.length === 0) return null;
          return (
            <div className="px-5 py-4 border-b border-slate-800/40">
              <h3 className="text-[20px] md:text-[22px] font-semibold text-slate-100 leading-tight mb-3">
                Почему такой балл?
              </h3>
              <ul className="space-y-2">
                {mergedRu.map((line, i) => (
                  <li key={i} className="flex items-start gap-2 text-[16px] text-slate-300 leading-snug">
                    <span className="mt-[7px] shrink-0 w-1.5 h-1.5 rounded-full bg-sky-500/80" />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          );
        }

        const posFactors = [...rawPos];
        const negFactors = [...rawNeg];
        const hasDetailed = posFactors.length > 0 || negFactors.length > 0;
        const rawGeneric = hasDetailed ? [] : generateScoreFactors(analysis, locale);
        const genericFactors = rawGeneric;

        if (!hasDetailed && genericFactors.length === 0 && regionalRuExtras.length === 0) return null;

        return (
          <div className="px-5 py-4 border-b border-slate-800/40">
            <h3 className="text-[20px] md:text-[22px] font-semibold text-slate-100 leading-tight mb-3">
              {locale === 'ru' ? 'Почему такой балл?' : 'Why this score?'}
            </h3>
            {hasDetailed ? (
              <div className="space-y-1.5">
                {posFactors.map((factor, i) => (
                  <div key={`pos-${i}`} className="flex items-start gap-2 text-[15px] text-slate-300 leading-snug">
                    <span className="mt-[6px] shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    {factor}
                  </div>
                ))}
                {negFactors.map((factor, i) => (
                  <div key={`neg-${i}`} className="flex items-start gap-2 text-[15px] text-slate-400 leading-snug">
                    <span className="mt-[6px] shrink-0 w-1.5 h-1.5 rounded-full bg-amber-500/70" />
                    {factor}
                  </div>
                ))}
                {regionalRuExtras.map((line, i) => (
                  <div key={`reg-${i}`} className="flex items-start gap-2 text-[15px] text-sky-200/90 leading-snug">
                    <span className="mt-[6px] shrink-0 w-1.5 h-1.5 rounded-full bg-sky-400/90" />
                    {line}
                  </div>
                ))}
              </div>
            ) : (
              <ul className="space-y-1.5">
                {genericFactors.map((factor, i) => (
                  <li key={i} className="flex items-start gap-2 text-[15px] text-slate-400 leading-snug">
                    <span className="mt-[6px] shrink-0 w-1.5 h-1.5 rounded-full bg-slate-600" />
                    {factor}
                  </li>
                ))}
                {regionalRuExtras.map((line, i) => (
                  <li key={`reg-f-${i}`} className="flex items-start gap-2 text-[15px] text-sky-200/90 leading-snug">
                    <span className="mt-[6px] shrink-0 w-1.5 h-1.5 rounded-full bg-sky-400/90" />
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })()}

      <NeighborhoodEnvironmentPanel
        analysis={analysis}
        locale={locale}
        c={c}
        hideAmbientFinePrint={isRuResidentialDemo}
      />

      {/* Audience reasoning — why this audience was determined (EN only; RU hides raw internal magnets) */}
      {(() => {
        const _loc: string = locale; // prevents TS from narrowing `locale` inside this block
        if (_loc === 'ru') return null;
        const aa = analysis.audienceAnalysis;
        if (!aa) return null;
        const topMagnets = aa.primaryMagnets.slice(0, 3);
        if (topMagnets.length === 0 && !aa.primaryDriverLabel) return null;

        const fmtD = (m: number) =>
          locale === 'ru'
            ? (m < 1000 ? `${Math.round(m / 10) * 10} м` : `${(m / 1000).toFixed(1)} км`)
            : (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

        return (
          <div className="px-5 py-4 border-b border-slate-800/40">
            <p className="text-[12px] text-slate-500 uppercase tracking-[0.16em] mb-3">
              {locale === 'ru' ? 'Почему такая аудитория?' : 'Why this audience?'}
            </p>
            {aa.primaryDriverLabel && (
              <p className="text-[14px] text-slate-300 leading-snug mb-3">{aa.primaryDriverLabel}</p>
            )}
            {topMagnets.length > 0 && (
              <div className="space-y-2 mb-2">
                {topMagnets.map((pm, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className={`mt-[6px] shrink-0 w-1.5 h-1.5 rounded-full ${pm.type === 'business' ? 'bg-blue-400' : 'bg-amber-400'}`} />
                    <p className="text-[14px] text-slate-400 leading-snug">
                      <span className="text-slate-200">{pm.name}</span>
                      {' · '}{fmtD(pm.distance)}
                      {' · '}
                      <span className="text-slate-500">
                        {pm.type === 'business'
                          ? (locale === 'ru' ? 'деловой магнит' : 'business magnet')
                          : (locale === 'ru' ? 'туристический магнит' : 'tourist magnet')}
                      </span>
                      {pm.subType ? ` · ${pm.subType}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {aa.audienceSharePct >= 50 && aa.primaryAudience === 'BUSINESS' && (
              <p className="text-[13px] text-slate-500">
                {locale === 'ru'
                  ? `${aa.audienceSharePct}% расчётной доли спроса — деловой сегмент${aa.businessClusterDetected ? ' · кластер ≥2 деловых объектов в 1 км' : ''}`
                  : `${aa.audienceSharePct}% of modeled demand — business segment${aa.businessClusterDetected ? ' · cluster ≥2 business within 1 km' : ''}`}
              </p>
            )}
            {aa.fallbackMode && (
              <p className="text-[13px] text-amber-500/80 mt-1">
                {locale === 'ru'
                  ? 'Деловых магнитов не обнаружено — анализ по туристической аудитории'
                  : 'No business magnets found — tourist audience fallback'}
              </p>
            )}
          </div>
        );
      })()}

      {analysis.locationScore && (() => {
        const _loc: string = locale;
        if (_loc === 'ru') return null;
        const ls = analysis.locationScore!
        const bd = ls.breakdown;

        const components: Array<{
          labelRu: string; labelEn: string;
          score: number;
        }> = [
          { labelRu: 'Соответствие аудитории', labelEn: 'Audience fit', score: bd.audience_fit_score },
          { labelRu: 'Спрос в зоне', labelEn: 'Demand', score: bd.demand_score },
          { labelRu: 'Свободная ниша', labelEn: 'Market gap', score: bd.supply_score },
          { labelRu: 'Доступность', labelEn: 'Accessibility', score: bd.accessibility_score },
        ];

        const supporting: Array<{ labelRu: string; labelEn: string; score: number }> = [
          { labelRu: 'Магниты спроса',        labelEn: 'Demand magnets',    score: bd.magnet_score },
          { labelRu: 'Устойчивость потока',   labelEn: 'Demand stability',  score: bd.seasonality_score },
        ];

        const barColor = (s: number) =>
          s >= 70 ? 'bg-emerald-500'
          : s >= 45 ? 'bg-amber-400'
          : 'bg-rose-500/70';

        const strongComps = components
          .filter(c => c.score >= 70)
          .map(c => (locale === 'ru' ? c.labelRu : c.labelEn));
        const weakComps = components
          .filter(c => c.score < 45)
          .map(c => (locale === 'ru' ? c.labelRu : c.labelEn));

        return (
          <div className="px-5 py-5 border-b border-slate-800/40">
            <div className="flex items-baseline justify-between mb-4">
              <p className="text-[12px] text-slate-500 uppercase tracking-[0.16em]">
                {locale === 'ru' ? 'Состав индекса' : 'Score breakdown'}
              </p>
              <span className="text-[13px] text-slate-500">
                {locale === 'ru' ? 'Индекс ' : 'Score '}<span className="font-semibold text-slate-300">{ls.location_score}</span>/100
              </span>
            </div>

            {/* Weighted components */}
            <div className="space-y-3">
              {components.map((comp) => (
                <div key={comp.labelRu}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[13px] text-slate-400">
                      {locale === 'ru' ? comp.labelRu : comp.labelEn}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className={`text-[13px] font-medium tabular-nums ${
                        comp.score >= 70 ? 'text-emerald-400'
                        : comp.score >= 45 ? 'text-amber-400'
                        : 'text-rose-400'
                      }`}>{comp.score}</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${barColor(comp.score)}`}
                      style={{ width: `${comp.score}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Supporting signals (no weight) */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-4 pt-3 border-t border-slate-800/30">
              {supporting.map((s) => (
                <div key={s.labelRu}>
                  <p className="text-[11px] text-slate-600 mb-0.5">{locale === 'ru' ? s.labelRu : s.labelEn}</p>
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${barColor(s.score)}`} style={{ width: `${s.score}%` }} />
                    </div>
                    <span className="text-[11px] text-slate-500 tabular-nums">{s.score}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Verdict linkage */}
            {(strongComps.length > 0 || weakComps.length > 0) && (
              <div className="mt-3 pt-3 border-t border-slate-800/40 space-y-1">
                {strongComps.length > 0 && (
                  <p className="text-[13px] text-slate-400 leading-snug">
                    <span className="text-emerald-400">↑ </span>
                    {locale === 'ru' ? 'Поддерживает: ' : 'Supporting: '}
                    <span className="text-slate-300">{strongComps.join(', ')}</span>
                  </p>
                )}
                {weakComps.length > 0 && (
                  <p className="text-[13px] text-slate-400 leading-snug">
                    <span className="text-amber-400">↓ </span>
                    {locale === 'ru' ? 'Ограничивает: ' : 'Limiting: '}
                    <span className="text-slate-300">{weakComps.join(', ')}</span>
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Competitor breakdown — hidden on RU residential free/demo preview */}
      {!isRuResidentialDemo ? (
        <CompetitorBreakdownBlock
          analysis={analysis}
          locale={locale}
          suppressIncomeHints={false}
        />
      ) : null}

      {/* Recommended Strategy */}
      <div className="px-5 py-5 border-b border-slate-800/40">
        <h3 className="text-[20px] md:text-[22px] font-semibold text-slate-100 mb-3">
          {c.strategyTitle}
        </h3>
        <ul className="space-y-2.5">
          {strategyPoints.map((point, i) => (
            <li key={i} className="flex items-start gap-2 text-[16px] text-slate-300 leading-snug">
              <span className="mt-[5px] shrink-0 w-1.5 h-1.5 rounded-full bg-slate-600" />
              {point}
            </li>
          ))}
        </ul>
      </div>

      {/* Market snapshot — EN only; RU keeps the result page focused on the five core sections. */}
      {locale !== 'ru' && (
        <MarketSnapshotTable
          evergreenIndex={evergreenIndex}
          demandType={analysis.demandType}
          competitorCount={competitors.length}
          strategy={strategy}
          locale={locale}
          c={c}
        />
      )}

      {/* CTA — lead capture (RU residential free/demo uses page-level footer CTA only) */}
      {!isRuResidentialDemo ? (
        <div className="px-5 py-5 border-b border-slate-800/40 bg-slate-800/20">
          <p className="text-[11px] text-slate-400 uppercase tracking-[0.16em] mb-2">{c.ctaBlock.title}</p>
          <p className="text-[14px] text-slate-400 leading-snug mb-4">
            {c.ctaBlock.body}
          </p>
          <button
            onClick={() =>
              router.push(LOCATION_REPORT_PRODUCT_PATH)}
            className="w-full py-3 px-4 rounded-xl bg-slate-100 hover:bg-white hover:brightness-110 text-slate-900 text-[14px] font-semibold tracking-wide transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 active:scale-[0.99]"
          >
            {c.ctaBlock.button}
          </button>
          <p className="mt-2 text-[13px] text-slate-500 text-center">{c.ctaBlock.note}</p>
        </div>
      ) : null}

      {/* Analytics: gravity signals + foot traffic — EN only; RU hides internal zone/magnet labels */}
      {hasMagnets && locale !== 'ru' && (
        <div className="px-5 py-4 border-b border-slate-800/40">
          <div className="grid grid-cols-2 gap-x-5 gap-y-3">
            {gravityExplanation.strongestZoneLabel && (
              <div className="col-span-2">
                <p className="text-[11px] text-slate-600 uppercase tracking-[0.14em] mb-0.5">{c.keyZone}</p>
                <p className="text-[17px] text-slate-300">{gravityExplanation.strongestZoneLabel}</p>
              </div>
            )}
            {gravityExplanation.dominantMagnets[0] && (
              <div className="col-span-2">
                <p className="text-[11px] text-slate-600 uppercase tracking-[0.14em] mb-0.5">{c.topMagnet}</p>
                <p className="text-[17px] text-slate-300 truncate">{gravityExplanation.dominantMagnets[0]}</p>
              </div>
            )}
            <div>
              <p className="text-[11px] text-slate-600 uppercase tracking-[0.14em] mb-0.5">{c.competitors}</p>
              <p className={`text-[17px] font-medium ${
                gravityExplanation.competitorPressureLevel === 'high' ? 'text-rose-400'
                : gravityExplanation.competitorPressureLevel === 'medium' ? 'text-amber-400'
                : 'text-emerald-400'
              }`}>{competitorLabel(gravityExplanation.competitorPressureLevel, locale)}</p>
            </div>
            {gravityExplanation.clusterDetected && (
              <div>
                <p className="text-[11px] text-slate-600 uppercase tracking-[0.14em] mb-0.5">{c.cluster}</p>
                <p className="text-[17px] text-slate-300">{c.nearbySuffix(gravityExplanation.clusterSize)}</p>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-3 mt-3 pt-3 border-t border-slate-800/40">
            <div>
              <p className="text-[11px] text-slate-600 uppercase tracking-[0.14em] mb-0.5">{c.density}</p>
              <p className="text-[17px] text-slate-300">{footTraffic.movementDensity}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-600 uppercase tracking-[0.14em] mb-0.5">{c.zoneActivity}</p>
              <p className="text-[17px] text-slate-300">{footTraffic.zoneActivity}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-600 uppercase tracking-[0.14em] mb-0.5">{c.stability}</p>
              <p className="text-[17px] text-slate-300">{footTraffic.flowStability}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-600 uppercase tracking-[0.14em] mb-0.5">{c.targetFlow}</p>
              <p className="text-[17px] text-slate-300">{footTraffic.flowCharacter}</p>
            </div>
          </div>
        </div>
      )}

      {/* Magnets — EN only; RU hides raw internal POI distance list */}
      {hasMagnets && (() => {
        const _loc: string = locale;
        if (_loc === 'ru') return null;
        const isResidentialPrime = mode === 'residential';
        const MAGNET_DEFAULT_LIMIT = isResidentialPrime ? 5 : 6;
        const allFiltered = isResidentialPrime
          ? selectResidentialPrimeMagnetItems(magnets, { market: 'RU', defaultTop: 3, hardMax: 5 })
          : getFilteredMagnets(magnets, magnets.length);
        const shown = isResidentialPrime
          ? allFiltered
          : (magnetExpanded ? allFiltered : allFiltered.slice(0, MAGNET_DEFAULT_LIMIT));
        const hiddenCount = allFiltered.length - MAGNET_DEFAULT_LIMIT;

        const fmtDist = (m: number) =>
          locale === 'ru'
            ? (m < 1000 ? `${Math.round(m / 10) * 10} м` : `${(m / 1000).toFixed(1)} км`)
            : formatDist(m);

        const strengthLabel = (sc: string) => {
          if (locale === 'ru') {
            return sc === 'strong' ? 'первичный' : sc === 'medium' ? 'вторичный' : 'слабый';
          }
          return sc === 'strong' ? 'primary' : sc === 'medium' ? 'secondary' : 'weak';
        };
        const strengthColor = (sc: string) =>
          sc === 'strong' ? 'text-indigo-400' : sc === 'medium' ? 'text-slate-400' : 'text-slate-600';

        return (
          <div className="px-5 pt-4 pb-3">
            <div className="flex items-baseline justify-between mb-1">
              <p className="text-[13px] font-semibold text-slate-500 uppercase tracking-[0.18em]">
                {c.magnetsAround}
              </p>
              <span className="text-[13px] text-slate-600">{c.significantCount(allFiltered.length)}</span>
            </div>
            {!isResidentialPrime && (
              <p className="text-[12px] text-slate-700 mb-3">
                {locale === 'ru'
                  ? 'первичный = сильный магнит спроса · вторичный = поддерживающий'
                  : 'primary = strong demand magnet · secondary = supporting'}
              </p>
            )}
            <div className="space-y-0">
              {shown.map((m, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 py-2.5 border-b border-slate-800/30 last:border-0"
                >
                  <span
                    className="mt-0.5 shrink-0 w-6 h-6 flex items-center justify-center rounded text-[14px] font-bold bg-slate-800/60"
                    style={{ color: CATEGORY_COLOR[m.categoryId] }}
                  >
                    {m.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[18px] text-slate-200 leading-snug truncate">{m.name}</p>
                    <p className="text-[14px] text-slate-500 mt-0.5">
                      {magnetCategoryLabel(m.categoryId, locale)}
                      {(() => {
                        const why = magnetWhy(m.categoryId, locale);
                        return why ? ` · ${why}` : '';
                      })()}
                    </p>
                    <p className={`text-[12px] mt-0.5 ${strengthColor(m.strengthClass)}`}>
                      {strengthLabel(m.strengthClass)}
                      {m.scopeLevel !== 'local' ? ` · ${m.scopeLevel}` : ''}
                    </p>
                  </div>
                  <span className="text-[16px] text-slate-500 shrink-0 tabular-nums mt-0.5">
                    {fmtDist(m.distance)}
                  </span>
                </div>
              ))}
            </div>
            {!isResidentialPrime && !magnetExpanded && hiddenCount > 0 && (
              <button
                onClick={() => setMagnetExpanded(true)}
                className="mt-3 inline-flex items-center gap-2 text-[16px] text-slate-400 hover:text-slate-200 transition-colors underline underline-offset-4 decoration-slate-700 hover:decoration-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/25 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 rounded"
              >
                {c.showMoreMagnets(hiddenCount)}
              </button>
            )}
            {!isResidentialPrime && magnetExpanded && allFiltered.length > MAGNET_DEFAULT_LIMIT && (
              <button
                onClick={() => setMagnetExpanded(false)}
                className="mt-3 inline-flex items-center gap-2 text-[16px] text-slate-400 hover:text-slate-200 transition-colors underline underline-offset-4 decoration-slate-700 hover:decoration-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/25 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 rounded"
              >
                {c.collapse}
              </button>
            )}
          </div>
        );
      })()}

    </div>
    </>
  );
}

// ── Commercial mode components ─────────────────────────────────────────────────

function CommercialFlowBlock({ analysis, locale }: { analysis: LocationAnalysis; locale: LocDemoLocale }) {
  const ft = analysis.footTraffic;
  const { transitShare, localActiveShare, destinationShare } = ft.transitVsTarget;

  let conclusion: string;
  if (destinationShare >= 0.45)
    conclusion = 'У точки есть сильный целевой поток — люди приходят сюда намеренно.';
  else if (transitShare >= 0.50)
    conclusion = 'В локации преобладает транзитный поток — высокая проходимость, но низкая задерживаемость.';
  else if (localActiveShare >= 0.40)
    conclusion = 'Активная локальная аудитория — жители и работающие рядом составляют основу потока.';
  else
    conclusion = 'Поток смешанный: часть людей проходит транзитом, часть приходит целенаправленно.';

  const bars: Array<{ label: string; share: number; color: string; desc: string }> = [
    { label: 'Транзитный', share: transitShare, color: 'bg-indigo-400', desc: 'Проходящие мимо без намерения остановиться' },
    { label: 'Локальный', share: localActiveShare, color: 'bg-amber-400', desc: 'Жители и работающие рядом' },
    { label: 'Целевой', share: destinationShare, color: 'bg-emerald-400', desc: 'Приходящие в эту зону с целью' },
  ];

  return (
    <div className="px-5 py-5 border-b border-slate-800/40">
      <p className="text-[12px] text-slate-500 uppercase tracking-[0.16em] mb-4">Структура потока</p>
      <div className="space-y-4">
        {bars.map(b => (
          <div key={b.label} className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-slate-400">{b.label}</span>
              <span className="text-[13px] font-semibold text-slate-200">{Math.round(b.share * 100)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
              <div
                className={`h-full rounded-full ${b.color}`}
                style={{ width: `${Math.round(b.share * 100)}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-600">{b.desc}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 p-3 rounded-xl bg-slate-800/30 border border-slate-700/30">
        <p className="text-[13px] text-slate-300">{conclusion}</p>
      </div>
    </div>
  );
}

function CommercialFormatFitBlock({ analysis }: { analysis: LocationAnalysis }) {
  const fit = buildCommercialFormatFit(analysis);
  const topEntries = fit.entries.filter(e => e.fitLevel === 'high' || e.fitLevel === 'medium').slice(0, 3);
  const allEntries = fit.entries;

  return (
    <div className="px-5 py-5 border-b border-slate-800/40">
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-[12px] text-slate-500 uppercase tracking-[0.16em]">Форматный потенциал</p>
        <span className="text-[12px] text-slate-500">{fit.overallVerdictLabelRu}</span>
      </div>
      <div className="space-y-3">
        {allEntries.map(entry => (
          <div key={entry.format} className="flex items-start justify-between gap-3">
            <span className="text-[13px] text-slate-300 leading-snug">{entry.formatLabelRu}</span>
            <span className={`text-[12px] font-semibold shrink-0 ${FIT_LEVEL_COLOR[entry.fitLevel]}`}>
              {FIT_LEVEL_LABEL_RU[entry.fitLevel]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CommercialASIPanel({
  analysis,
  address,
  animated,
  meta,
  locale,
  c,
}: {
  analysis: LocationAnalysis;
  address: string;
  animated: boolean;
  meta: AnalysisMeta | null;
  locale: LocDemoLocale;
  c: (typeof LOC_COPY)['en'];
}) {
  const router = useRouter();
  const band = getBand(analysis.evergreenIndex, analysis.audienceAnalysis?.primaryAudience);
  const [visible, setVisible] = useState(false);
  const [fullReportBusy, setFullReportBusy] = useState(false);
  const [fullReportErr, setFullReportErr] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(t);
  }, []);

  const fit = buildCommercialFormatFit(analysis);
  const verdictColorClass =
    fit.overallVerdict === 'strong' ? 'text-emerald-400' :
    fit.overallVerdict === 'selective' ? 'text-amber-400' :
    fit.overallVerdict === 'weak' ? 'text-orange-400' :
    'text-slate-500';

  async function requestFullReportAsync() {
    if (fullReportBusy) return;
    setFullReportErr(null);
    setFullReportBusy(true);
    try {
      const res = await fetch('/api/location-full-report/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          address,
          locale,
          mode: 'commercial',
          delivery: { channel: 'dashboard', target: 'public' },
          access_tier: 'unknown',
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.requestId) throw new Error(json?.error || 'request_failed');
      const requestId = String(json.requestId);

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      fetch('/api/location-full-report/process', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId }),
        keepalive: true,
      });

      const pollStart = Date.now();
      for (;;) {
        const s = await fetch(`/api/location-full-report/request/${requestId}`, { cache: 'no-store' });
        const sj = await s.json().catch(() => ({}));
        if (!s.ok) throw new Error(sj?.error ?? 'status_failed');
        if (sj?.status === 'completed' && sj?.reportId) {
          const reportId = String(sj.reportId);
          router.push(buildLocationReportPermalink({ reportId, locale }));
          return;
        }
        if (sj?.status === 'failed') throw new Error(sj?.error ?? 'processing_failed');
        if (Date.now() - pollStart > 90_000) throw new Error('timeout');
        await new Promise<void>(resolve => setTimeout(resolve, 1500));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFullReportErr(msg);
    } finally {
      setFullReportBusy(false);
    }
  }

  function openCommercialReport() {
    (async () => {
      const report = buildCommercialReport({ address, analysis });
      try {
        const res = await fetch('/api/location-standalone-report', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ locale: 'ru', report }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.reportId) throw new Error(json?.error || 'create_failed');
        router.push(buildLocationReportPermalink({ reportId: String(json.reportId), locale: 'ru' }));
      } catch {
        router.push(LOCATION_REPORT_SAMPLE_PATH);
      }
    })();
  }

  return (
    <div
      className={`rounded-2xl border ${band.border} ${band.bg} overflow-hidden`}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(10px)',
        transition: 'opacity 0.4s ease, transform 0.4s ease',
      }}
    >
      {meta ? <AnalysisFreshnessStrip meta={meta} locale={locale} c={c} /> : null}

      {/* Header KPIs */}
      <div className="grid grid-cols-2 border-b border-slate-800/60">
        <div className="flex flex-col items-center justify-center gap-1 p-5 border-r border-slate-800/40">
          <EvergreenRing index={analysis.evergreenIndex} band={band} animated={animated} copy={c} />
        </div>
        <div className="flex flex-col justify-center gap-0.5 p-5">
          <p className="text-[14px] font-semibold text-slate-400 mb-1">Потенциал формата</p>
          <p className={`text-[20px] font-bold leading-tight ${verdictColorClass}`}>
            {fit.overallVerdictLabelRu}
          </p>
          <p className="text-[14px] text-slate-400 mt-1 leading-snug font-medium">
            {analysis.magnets.length} объектов притяжения рядом ·{' '}
            {analysis.demandType === 'business-led'
              ? 'спрос завязан на офисный и деловой трафик'
              : analysis.demandType === 'tourism-led'
                ? 'спрос завязан на туристический и досуговой трафик'
                : analysis.demandType === 'transport-led'
                  ? 'спрос завязан на транзит и транспортную связность'
                  : 'смешанный профиль спроса'}
          </p>
        </div>
      </div>

      {/* Flow block */}
      <CommercialFlowBlock analysis={analysis} locale={locale} />

      {/* Format fit matrix */}
      <CommercialFormatFitBlock analysis={analysis} />

      {/* CTA */}
      <div className="px-5 py-5">
        <button
          type="button"
          onClick={openCommercialReport}
          className="w-full py-3 px-4 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-[14px] font-semibold tracking-wide transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
        >
          Открыть демо‑перmalink (пространственный)
        </button>
        <button
          type="button"
          onClick={requestFullReportAsync}
          disabled={fullReportBusy}
          className="mt-2 w-full py-3 px-4 rounded-xl bg-slate-900/40 hover:bg-slate-900/60 disabled:bg-slate-900/25 border border-slate-800/60 text-slate-100 text-[13px] font-semibold transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
        >
          {fullReportBusy ? 'Готовим полный отчёт…' : 'Заказать отчёт'}
        </button>
        {fullReportErr ? (
          <p className="mt-1 text-[11px] text-amber-400/90 text-center">
            Не удалось запустить полный отчёт: {fullReportErr}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export type LocationAnalysisMode = 'residential' | 'commercial';

export function LocationIntelligenceDemo({
  locale = 'en',
  initialMode = 'residential',
  edgeToHeader = false,
}: {
  locale?: LocDemoLocale;
  initialMode?: LocationAnalysisMode;
  /** When true, section sits directly under the site header (no page-level intro above). */
  edgeToHeader?: boolean;
}) {
  const c = LOC_COPY[locale];
  const locTel = useLocationTelemetryOptional();
  const locTelRef = useRef(locTel);
  locTelRef.current = locTel;
  const mode: LocationAnalysisMode = initialMode;
  const prevInitialModeRef = useRef(initialMode);
  const [selected, setSelected] = useState<SelectedAddress | null>(null);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'result'>('idle');
  const [step, setStep] = useState(0);
  const [analysis, setAnalysis] = useState<LocationAnalysis | null>(null);
  const [analysisMeta, setAnalysisMeta] = useState<AnalysisMeta | null>(null);
  const [animated, setAnimated] = useState(false);
  const [validationErr, setValidationErr] = useState(false);
  const [addressDraft, setAddressDraft] = useState('');
  const [geocodeFallbackBusy, setGeocodeFallbackBusy] = useState(false);
  const [fallbackGeocodeErr, setFallbackGeocodeErr] = useState<string | null>(null);
  const [usedFallbackGeocode, setUsedFallbackGeocode] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  const [activeTag, setActiveTag] = useState<number | null>(null);
  const [mapFeedback, setMapFeedback] = useState<string | null>(null);
  const mapFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapDivRef = useRef<HTMLDivElement>(null);
  const heatmapDivRef = useRef<HTMLDivElement>(null);

  function showMapFeedback(msg: string) {
    if (mapFeedbackTimerRef.current) clearTimeout(mapFeedbackTimerRef.current);
    setMapFeedback(msg);
    mapFeedbackTimerRef.current = setTimeout(() => setMapFeedback(null), 2000);
  }

  const GEOCODE_FALLBACK_MS = 18_000;

  useEffect(() => {
    if (prevInitialModeRef.current === initialMode) return;
    prevInitialModeRef.current = initialMode;
    setPhase('idle');
    setAnalysis(null);
    setAnalysisMeta(null);
    setAnimated(false);
    setValidationErr(false);
    setSelected(null);
    setAddressDraft('');
    setFallbackGeocodeErr(null);
    setGeocodeFallbackBusy(false);
    setUsedFallbackGeocode(false);
    setInputKey(k => k + 1);
    setActiveTag(null);
    locTelRef.current?.resetTelemetry();
  }, [initialMode]);

  function startAnalysisRun() {
    setValidationErr(false);
    setFallbackGeocodeErr(null);
    locTel?.pushLine({ badge: 'RUN', text: c.runStarted, kind: 'info' });
    setPhase('loading');
    setStep(0);
    setAnalysis(null);
    setAnalysisMeta(null);
    setAnimated(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (phase === 'loading' || geocodeFallbackBusy) return;

    if (selected) {
      startAnalysisRun();
      return;
    }

    const q = addressDraft.trim();
    if (q.length < 2) {
      setValidationErr(true);
      setFallbackGeocodeErr(null);
      console.warn('[location-demo] submit blocked', { reason: 'empty_or_short_draft', qLen: q.length });
      return;
    }

    setValidationErr(false);
    setFallbackGeocodeErr(null);
    console.info('[location-demo] submit fallback_geocode_start', { locale, qLen: q.length, q: truncateForLog(q, 64) });
    setGeocodeFallbackBusy(true);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GEOCODE_FALLBACK_MS);
      const res = await fetch('/api/location-geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: q, locale }),
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timer);
      const raw = (await res.json().catch(() => ({}))) as { error?: unknown; address?: unknown; lat?: unknown; lon?: unknown };
      if (!res.ok) {
        const serverMsg = typeof raw.error === 'string' ? raw.error : '';
        console.warn('[location-demo] fallback_geocode http_error', {
          httpStatus: res.status,
          serverMsg: truncateForLog(serverMsg, 120),
        });
        setFallbackGeocodeErr(c.fallbackGeocodeFailed);
        return;
      }
      if (typeof raw.lat !== 'number' || typeof raw.lon !== 'number') {
        console.warn('[location-demo] fallback_geocode invalid_body');
        setFallbackGeocodeErr(c.fallbackGeocodeFailed);
        return;
      }
      const label = typeof raw.address === 'string' && raw.address.trim() ? raw.address.trim() : q;
      console.info('[location-demo] fallback_geocode ok', {
        address: truncateForLog(label, 64),
        lat: raw.lat,
        lon: raw.lon,
      });
      rememberRecentAddress(label);
      setSelected({ value: label, lat: raw.lat, lon: raw.lon });
      setUsedFallbackGeocode(true);
      locTel?.pushLine({
        badge: 'ADR',
        text: c.addrChosenLog(truncateForLog(label)),
        kind: 'info',
      });
      startAnalysisRun();
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      console.warn('[location-demo] fallback_geocode client_error', {
        aborted,
        message: err instanceof Error ? err.message : String(err),
      });
      setFallbackGeocodeErr(c.fallbackGeocodeFailed);
    } finally {
      setGeocodeFallbackBusy(false);
    }
  }

  function reset() {
    setSelected(null);
    setPhase('idle');
    setAnalysis(null);
    setAnalysisMeta(null);
    setAnimated(false);
    setValidationErr(false);
    setAddressDraft('');
    setFallbackGeocodeErr(null);
    setGeocodeFallbackBusy(false);
    setUsedFallbackGeocode(false);
    setInputKey(k => k + 1);
    setActiveTag(null);
    locTel?.resetTelemetry();
  }

  // Loading: step ticker + server-side OSM fetch + analysis
  useEffect(() => {
    if (phase !== 'loading' || !selected) return;
    let cancelled = false;
    const controller = new AbortController();
    const abortTimeout = setTimeout(() => controller.abort(), LOCATION_ANALYSIS_FETCH_MS);

    const STEP_MS = 680;
    const tickers = c.loadingSteps.map((_, i) =>
      i === 0 ? null : setTimeout(() => { if (!cancelled) setStep(i); }, i * STEP_MS),
    ).filter(Boolean) as ReturnType<typeof setTimeout>[];

    const fetchStart = Date.now();
    fetchLocationAnalysis(selected.lat, selected.lon, controller.signal, {
      spatialFoundation: mode === 'commercial',
    }).then(result => {
      clearTimeout(abortTimeout);
      if (cancelled) return;
      const resolvedAnalysis = result?.analysis ?? buildAnalysis([], selected.lat, selected.lon, {
        spatialFoundation: mode === 'commercial',
      });
      const resolvedMetaBase = result?.meta ?? null;
      const resolvedMeta: AnalysisMeta | null =
        resolvedMetaBase && usedFallbackGeocode
          ? {
            ...resolvedMetaBase,
            warnings: [
              ...(resolvedMetaBase.warnings ?? []),
              {
                code: 'geocode_fallback',
                message: locale === 'ru'
                  ? 'Адрес был геокодирован по введённому тексту — точность может быть ниже.'
                  : 'Address was geocoded from typed text — precision may be lower.',
              },
            ],
          }
          : resolvedMetaBase;
      const elapsed = Date.now() - fetchStart;
      setTimeout(() => {
        if (cancelled) return;
        setAnalysis(resolvedAnalysis);
        setAnalysisMeta(resolvedMeta);
        setPhase('result');
        const tel = locTelRef.current;
        if (tel) {
          emitAnalysisTelemetry(tel.pushLine, tel.updateSnapshot, resolvedAnalysis, resolvedMeta, locale, c);
        }
        setTimeout(() => { if (!cancelled) setAnimated(true); }, 80);
      }, Math.max(0, 3600 - elapsed));
    });

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(abortTimeout);
      tickers.forEach(clearTimeout);
    };
  }, [phase, selected, locale, c, mode, usedFallbackGeocode]);

  return (
    <section
      className={
        edgeToHeader
          ? 'pt-6 sm:pt-8 pb-20 sm:pb-24 px-4 sm:px-6 bg-slate-950'
          : 'py-20 sm:py-24 px-4 sm:px-6 border-t border-slate-800/60 bg-slate-950'
      }
    >
      <div className="max-w-6xl mx-auto text-left">

        {/* Section header — mode-aware */}
        <div className={`max-w-2xl space-y-5 ${edgeToHeader ? 'mb-6 sm:mb-8' : 'mb-10'}`}>
          <div className="space-y-4">
            {locale === 'ru' && mode === 'commercial' ? (
              <>
                <h2 className="text-4xl sm:text-5xl font-bold text-white leading-[1.1] tracking-tight">
                  Детальная пространственная карта локации
                </h2>
                <p className="text-lg sm:text-xl text-slate-400 leading-relaxed">
                  Не просто «хорошее место» или «плохое» — а какой тип потока здесь преобладает и какому формату это подходит.
                </p>
                <div className="pt-2 border-t border-slate-800/80 space-y-2">
                  <p className="text-xl sm:text-2xl font-semibold text-slate-100 leading-snug">
                    Пространственный анализ для бизнеса
                  </p>
                  <p className="text-base text-slate-400 leading-relaxed">
                    Введите адрес точки — получите структуру потока, форматную матрицу и барьеры до того, как вы вложили деньги или время.
                  </p>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-4xl sm:text-5xl font-bold text-white leading-[1.1] tracking-tight whitespace-pre-line">
                  {c.sectionTitle}
                </h2>
                <p className="text-lg sm:text-xl text-slate-400 leading-relaxed whitespace-pre-line">
                  {c.sectionLead}
                </p>
                {(c.sectionSub1 || c.sectionSub2) && (
                  <div className="space-y-3 pt-2 border-t border-slate-800/80">
                    {c.sectionSub1 && (
                      <p className="text-xl sm:text-2xl font-semibold text-slate-100 leading-snug whitespace-pre-line">
                        {c.sectionSub1}
                      </p>
                    )}
                    {c.sectionSub2 && (
                      <p className="text-base sm:text-lg text-slate-400 leading-relaxed whitespace-pre-line">
                        {c.sectionSub2}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── RESULT PHASE ── */}
        {phase === 'result' && analysis ? (
          <div className="space-y-6">

            {/* Map */}
            <div className="flex items-center gap-2 mb-3">
                <span className="text-[18px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                  {c.envMapTitle}
                </span>
                <span className="text-[17px] text-slate-700">· 2GIS</span>
            </div>
            {mapFeedback && (
              <div className="text-sm text-slate-400 mb-2 transition-opacity">
                {mapFeedback}
              </div>
            )}
            <div ref={mapDivRef}>
              <TwoGISMapPanel
                lat={selected!.lat}
                lon={selected!.lon}
                loading={false}
                locale={locale}
                c={c}
                height={locale === 'ru' && mode === 'residential' ? 520 : undefined}
              />
            </div>
            <div className="mt-3">
              <p className={locale === 'ru' && mode === 'residential'
                ? 'text-[17px] sm:text-[19px] text-slate-300 leading-snug'
                : 'text-[20px] text-slate-500 mb-2 truncate'
              }>{selected?.value}</p>
              {!(locale === 'ru' && mode === 'residential') && (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {c.tags.map((tag, i) => (
                        <button
                          key={i}
                          type="button"
                          title={c.tagTooltips[i]}
                          onClick={() => {
                            if (i === 0) {
                              setActiveTag(0);
                              showMapFeedback(c.mapFeedback.showingProperty);
                              mapDivRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              return;
                            }

                            // RU: chips are only internal navigation (no external side-effects)
                            if (locale === 'ru') {
                              if (i === 1) {
                                setActiveTag(1);
                                showMapFeedback(c.mapFeedback.showingNearbyPlaces);
                                heatmapDivRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                              }
                              return;
                            }

                            // EN: keep legacy behavior for 4 chips
                            if (i === 1) {
                              setActiveTag(1);
                              showMapFeedback('Showing transport routes...');
                              if (selected) {
                                const url = isIOS()
                                  ? `http://maps.apple.com/?daddr=${encodeURIComponent(selected.value)}&dirflg=r`
                                  : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(selected.value)}&travelmode=transit`;
                                window.open(url, '_blank');
                              }
                            } else if (i === 2) {
                              setActiveTag(2);
                              showMapFeedback('Showing nearby places...');
                              heatmapDivRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                            } else if (i === 3) {
                              showMapFeedback('Opening full map...');
                              if (selected) window.open(getExternalMapUrl(selected.value), '_blank');
                            }
                          }}
                          className={`text-[17px] px-2 py-0.5 rounded-full border transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/40 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${
                            activeTag === i
                              ? 'bg-indigo-900/50 text-indigo-300 border-indigo-700/60'
                              : 'bg-slate-900/40 text-slate-400 border-slate-800 hover:bg-slate-800/60 hover:text-slate-200 hover:border-slate-700'
                          }`}
                        >
                          {tag}
                        </button>
                      ))}
                  </div>
                  {selected && (
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                        <a
                          href={
                            isIOS()
                              ? `http://maps.apple.com/?daddr=${encodeURIComponent(selected.value)}&dirflg=r`
                              : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(selected.value)}&travelmode=transit`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[13px] text-slate-500 hover:text-slate-300 underline underline-offset-2 transition-colors"
                        >
                          {c.routeTransit}
                        </a>
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selected.value)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[13px] text-slate-500 hover:text-slate-300 underline underline-offset-2 transition-colors"
                        >
                          {c.openInGoogleMaps}
                        </a>
                        {isIOS() && (
                          <a
                            href={`http://maps.apple.com/?q=${encodeURIComponent(selected.value)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[13px] text-slate-500 hover:text-slate-300 underline underline-offset-2 transition-colors"
                          >
                            {c.openInAppleMaps}
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            showMapFeedback(c.mapFeedback.openingFullMap);
                            if (selected) window.open(getExternalMapUrl(selected.value), '_blank');
                          }}
                          className="text-[13px] text-slate-500 hover:text-slate-300 underline underline-offset-2 transition-colors"
                        >
                          {c.openMapNewTab}
                        </button>
                    </div>
                  )}
                </>
              )}
            </div>

              {/* Influence heatmap — EN only; hidden on RU public demo */}
              {locale !== 'ru' && (
                <div ref={heatmapDivRef}>
                  <InfluenceHeatmapPanel
                    analysis={analysis}
                    subjectLat={selected!.lat}
                    subjectLon={selected!.lon}
                    locale={locale}
                    c={c}
                  />
                </div>
              )}

              <button
                onClick={reset}
                className="mt-5 w-full py-3 px-6 rounded-xl border border-slate-700/80 text-sm text-slate-400 hover:border-slate-600 hover:text-slate-200 hover:bg-slate-800/40 transition-all"
              >
                {c.tryAnother}
              </button>

              {/* Wide dashboard (full-width; no narrow right column) */}
              <div>
              <div className="flex items-center gap-2 mb-3">
                <span
                  className={
                    locale === 'ru' && mode === 'residential'
                      ? 'text-3xl sm:text-[40px] font-bold tracking-tight text-indigo-200 leading-tight'
                      : mode === 'commercial' && locale === 'ru'
                        ? 'text-3xl sm:text-[34px] font-bold tracking-tight text-indigo-200 leading-tight'
                        : 'text-[18px] font-semibold tracking-tight text-indigo-300'
                  }
                >
                  {mode === 'commercial' && locale === 'ru' ? 'Коммерческий анализ локации' : c.asiPanelTitle}
                </span>
              </div>
                {mode === 'commercial' && locale === 'ru' ? (
                  <CommercialASIPanel
                    analysis={analysis}
                    address={selected?.value ?? ''}
                    animated={animated}
                    meta={analysisMeta}
                    locale={locale}
                    c={c}
                  />
                ) : (
                  <ASIPanel
                    analysis={analysis}
                    address={selected?.value ?? ''}
                    animated={animated}
                    meta={analysisMeta}
                    locale={locale}
                    c={c}
                    mode={mode}
                  />
                )}
              </div>
            </div>
        ) : (
          // ── IDLE / LOADING PHASE ──
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-start">

            {/* Left: form */}
            <div>
              <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <AddressInput
                  key={inputKey}
                  onSelect={addr => {
                    setSelected(addr);
                    setValidationErr(false);
                    setFallbackGeocodeErr(null);
                    setUsedFallbackGeocode(false);
                    locTel?.pushLine({
                      badge: 'ADR',
                      text: c.addrChosenLog(truncateForLog(addr.value)),
                      kind: 'info',
                    });
                  }}
                  onClear={() => setSelected(null)}
                  onDraftChange={setAddressDraft}
                  disabled={phase === 'loading'}
                  locale={locale}
                  c={c}
                />
                {validationErr && (
                  <p className="text-sm text-rose-400 px-1" role="alert">
                    {c.pickAddressErr}
                  </p>
                )}
                {fallbackGeocodeErr && (
                  <p className="text-sm text-rose-400 px-1" role="alert">
                    {fallbackGeocodeErr}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={phase === 'loading' || geocodeFallbackBusy}
                  className="w-full py-4 px-8 bg-white text-slate-900 font-bold text-base rounded-xl hover:bg-slate-100 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-white/5 hover:shadow-white/10 hover:scale-[1.01] active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                >
                  {geocodeFallbackBusy
                    ? c.submitGeocodingAddress
                    : phase === 'loading'
                      ? c.loadingSteps[step]
                      : mode === 'commercial' && locale === 'ru'
                        ? 'Пространственный анализ точки'
                        : c.submitIdle}
                </button>
              </form>
              {phase === 'idle' && (
                <p className="mt-5 text-xs text-slate-400">
                  {c.osmNote}
                </p>
              )}
            </div>

            {/* Right: map */}
            <div>
              {selected ? (
                <TwoGISMapPanel
                  lat={selected.lat}
                  lon={selected.lon}
                  loading={phase === 'loading'}
                  locale={locale}
                  c={c}
                />
              ) : (
                <IdleMapPanel locale={locale} c={c} />
              )}
            </div>

          </div>
        )}


      </div>
    </section>
  );
}
