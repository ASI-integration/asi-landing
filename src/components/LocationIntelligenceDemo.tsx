'use client';

import { useState, useEffect, useId, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  CATEGORY_COLOR,
  buildAnalysis,
  getBand,
  formatDist,
  projectToSVG,
  patchLegacyLocationAnalysis,
} from '@/lib/location';
import type {
  LocationAnalysis,
  MagnetItem,
  Band,
  AnalysisMeta,
  DemandType,
} from '@/lib/location';
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
import { generateConclusion } from '@/lib/location';

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

// ── Address suggestion fetch (server-side locale routing; no browser Maps SDK) ─

const SUGGEST_TIMEOUT_MS = 8_000;
const RESOLVE_TIMEOUT_MS = 12_000;
/** Must allow Overpass + server cache work; short timeouts yield `buildAnalysis([])` fallback. */
const LOCATION_ANALYSIS_FETCH_MS = 55_000;

async function fetchAddressSuggestions(
  locale: LocDemoLocale,
  q: string,
): Promise<{ suggestions: Suggestion[]; status: SuggestStatus }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SUGGEST_TIMEOUT_MS);
  try {
    const res = await fetch(
      `/api/address-suggest?q=${encodeURIComponent(q)}&locale=${locale}`,
      { signal: controller.signal, cache: 'no-store' },
    );
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
    if (!res.ok) {
      return { suggestions: [], status: 'error' };
    }
    const suggestions: Suggestion[] = (data.suggestions ?? []).map(s => ({
      value: s.value,
      lat: s.lat,
      lon: s.lon,
      placeId: s.placeId,
      twogisItemId: s.twogisItemId,
    }));
    if (data.status === 'no_key') return { suggestions: [], status: 'no_key' };
    if (data.status === 'error') return { suggestions: [], status: 'error' };
    if (suggestions.length === 0) return { suggestions: [], status: 'no_results' };
    return { suggestions, status: 'ok' };
  } catch {
    return { suggestions: [], status: 'error' };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchLocationAnalysis(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<{ analysis: LocationAnalysis; meta: AnalysisMeta } | null> {
  try {
    const res = await fetch('/api/location-demo-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lon }),
      signal,
    });
    if (!res.ok) return null;
    const data = await res.json() as { analysis?: LocationAnalysis; meta?: AnalysisMeta };
    if (!data.analysis) return null;
    const analysis: LocationAnalysis = patchLegacyLocationAnalysis({
      ...data.analysis,
      accessibilityStops: data.analysis.accessibilityStops ?? [],
    });
    const meta: AnalysisMeta = data.meta ?? {
      freshness: 'fresh',
      updatedAt: new Date().toISOString(),
      source: 'osm-overpass',
      cached: false,
    };
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

function truncateForLog(s: string, max = 52): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
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
    { label: c.marketRows.avgAdr,          value: `$${adr}`,       tooltip: c.marketTooltips.avgAdr },
    { label: c.marketRows.estOccupancy,    value: `${occupancy}%` },
    { label: c.marketRows.revpar,          value: `$${revpar}`,    tooltip: c.marketTooltips.revpar },
    { label: c.marketRows.strategy,        value: strategyLabelMap[strategy] },
  ];

  return (
    <div className="px-5 py-5 border-b border-slate-800/40">
      <p className="text-[11px] text-slate-500 uppercase tracking-[0.16em] mb-4">{c.marketSnapshotTitle}</p>
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
            {locale === 'ru'
              ? 'Анализ начнётся после выбора точного адреса из списка'
              : 'Analysis starts after you select an exact address from the list'}
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
}: {
  lat: number;
  lon: number;
  loading: boolean;
  locale: LocDemoLocale;
  c: (typeof LOC_COPY)['en'];
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
        className="relative w-full rounded-2xl border border-slate-800 overflow-hidden"
        style={{ height: 420 }}
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
      className="relative w-full rounded-2xl border border-slate-800 overflow-hidden"
      style={{ height: 420 }}
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
  disabled,
  locale,
  c,
}: {
  onSelect: (addr: SelectedAddress) => void;
  onClear: () => void;
  disabled: boolean;
  locale: LocDemoLocale;
  c: (typeof LOC_COPY)['en'];
}) {
  const listboxId = useId();
  const [text, setText] = useState('');
  const [locked, setLocked] = useState(false);
  const [lockedValue, setLockedValue] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [fetching, setFetching] = useState(false);
  const [resolvingPick, setResolvingPick] = useState(false);
  const [resolveFailed, setResolveFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [suggestStatus, setSuggestStatus] = useState<SuggestStatus>('idle');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setText(val);
    setActiveIdx(-1);
    setResolveFailed(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (val.trim().length >= 2) {
      setFetching(true);
      debounceRef.current = setTimeout(async () => {
        try {
          const result = await fetchAddressSuggestions(locale, val);
          setSuggestions(result.suggestions);
          setSuggestStatus(result.status);
          setOpen(result.suggestions.length > 0);
        } finally {
          setFetching(false);
        }
      }, 280);
    } else {
      setSuggestions([]);
      setOpen(false);
      setSuggestStatus('idle');
      setFetching(false);
    }
  }

  async function pick(s: Suggestion) {
    if (resolvingPick) return;

    const doSelect = (lat: number, lon: number) => {
      setLocked(true);
      setLockedValue(s.value);
      setText('');
      setSuggestions([]);
      setOpen(false);
      setSuggestStatus('idle');
      setResolveFailed(false);
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
          doSelect(data.lat, data.lon);
          return;
        }
      }
      setResolveFailed(true);
    } catch {
      setResolveFailed(true);
    } finally {
      setResolvingPick(false);
    }
  }

  function clear() {
    setLocked(false);
    setLockedValue('');
    setText('');
    setSuggestions([]);
    setOpen(false);
    setActiveIdx(-1);
    setSuggestStatus('idle');
    setResolveFailed(false);
    onClear();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
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
  }

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
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
          placeholder={c.addressPlaceholder}
          disabled={disabled || resolvingPick}
          readOnly={locked}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={activeIdx >= 0 ? `${listboxId}-opt-${activeIdx}` : undefined}
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
  return all.slice(0, limit);
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

// ── ASI results panel ─────────────────────────────────────────────────────────

function ASIPanel({
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
        )
      : analysis.conclusion;
  const band = getBand(evergreenIndex);
  const strategy =
    evergreenIndex <= 6 ? 'mid_term' : evergreenIndex <= 7.5 ? 'hybrid' : 'short_term';
  const strategyPoints =
    strategy === 'mid_term' ? c.strategyMidTerm
    : strategy === 'hybrid' ? c.strategyHybrid
    : c.strategyShortTerm;
  const [visible, setVisible] = useState(false);
  const [magnetExpanded, setMagnetExpanded] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(t);
  }, []);

  const hasMagnets = magnets.length > 0;

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
      {/* Header: index ring + verdict */}
      <div className="p-5 flex items-center gap-4 border-b border-slate-800/60">
        <EvergreenRing index={evergreenIndex} band={band} animated={animated} copy={c} />
        <div className="min-w-0">
          <p className="text-[18px] font-semibold text-slate-500 uppercase tracking-[0.2em] mb-1">{c.analysisHeader}</p>
          <p className={`text-4xl font-bold leading-tight ${band.textColor}`}>{band.label}</p>
          {conclusion ? (
            <p className="mt-2 text-[22px] text-slate-400 leading-snug">{conclusion}</p>
          ) : null}
          <p
            className="mt-2 text-[18px] text-slate-600 leading-snug"
            style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
            title={address}
          >
            {address}
          </p>
        </div>
      </div>

      {/* Why this score? */}
      {(() => {
        const factors = generateScoreFactors(analysis, locale);
        if (factors.length === 0) return null;
        return (
          <div className="px-5 py-4 border-b border-slate-800/40">
            <p className="text-[11px] text-slate-500 uppercase tracking-[0.16em] mb-3">
              {locale === 'ru' ? 'Почему такой балл?' : 'Why this score?'}
            </p>
            <ul className="space-y-1.5">
              {factors.map((factor, i) => (
                <li key={i} className="flex items-start gap-2 text-[15px] text-slate-400 leading-snug">
                  <span className="mt-[5px] shrink-0 w-1.5 h-1.5 rounded-full bg-slate-600" />
                  {factor}
                </li>
              ))}
            </ul>
          </div>
        );
      })()}

      {/* Recommended Strategy */}
      <div className="px-5 py-5 border-b border-slate-800/40">
        <p className="text-[11px] text-slate-500 uppercase tracking-[0.16em] mb-3">{c.strategyTitle}</p>
        <ul className="space-y-2.5">
          {strategyPoints.map((point, i) => (
            <li key={i} className="flex items-start gap-2 text-[16px] text-slate-300 leading-snug">
              <span className="mt-[5px] shrink-0 w-1.5 h-1.5 rounded-full bg-slate-600" />
              {point}
            </li>
          ))}
        </ul>
      </div>

      {/* Estimated Monthly Income */}
      <div className="px-5 py-6 border-b border-slate-800/40">
        <p className="text-[11px] text-slate-500 uppercase tracking-[0.16em] mb-3">{c.incomeTitle}</p>
        <p className="text-[32px] font-bold text-slate-100 leading-none tracking-tight">
          {strategy === 'mid_term' ? '$1,800 – $3,200'
           : strategy === 'hybrid' ? '$2,500 – $4,500'
           : '$3,500 – $7,000'}
          <span className="text-[20px] font-semibold text-slate-400"> {c.incomeSuffix}</span>
        </p>
        <p className="text-[13px] text-slate-400 mt-2">{c.incomeDisclaimer1}</p>
        <p className="text-[12px] text-slate-500 mt-1">{c.incomeDisclaimer2}</p>
        <p className="text-[12px] text-slate-600 mt-0.5">{c.incomeDisclaimer3}</p>
      </div>

      {/* Market Snapshot */}
      <MarketSnapshotTable
        evergreenIndex={evergreenIndex}
        demandType={analysis.demandType}
        competitorCount={competitors.length}
        strategy={strategy}
        locale={locale}
        c={c}
      />

      {/* CTA — lead capture */}
      <div className="px-5 py-5 border-b border-slate-800/40 bg-slate-800/20">
        <p className="text-[11px] text-slate-400 uppercase tracking-[0.16em] mb-2">{c.ctaBlock.title}</p>
        <p className="text-[14px] text-slate-400 leading-snug mb-4">
          {c.ctaBlock.body}
        </p>
        <button
          onClick={() =>
            router.push(locale === 'ru' ? '/connect' : '/report')}
          className="w-full py-3 px-4 rounded-xl bg-slate-100 hover:bg-white hover:brightness-110 text-slate-900 text-[14px] font-semibold tracking-wide transition-colors cursor-pointer"
        >
          {c.ctaBlock.button}
        </button>
        <p className="mt-2 text-[13px] text-slate-500 text-center">{c.ctaBlock.note}</p>
      </div>

      {/* Analytics: gravity signals + foot traffic — combined compact grid */}
      {hasMagnets && (
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

      {/* Magnets */}
      {hasMagnets && (() => {
        const MAGNET_DEFAULT_LIMIT = 6;
        const allFiltered = getFilteredMagnets(magnets, magnets.length);
        const shown = magnetExpanded
          ? allFiltered
          : allFiltered.slice(0, MAGNET_DEFAULT_LIMIT);
        const hiddenCount = allFiltered.length - MAGNET_DEFAULT_LIMIT;
        return (
          <div className="px-5 pt-4 pb-3">
            <div className="flex items-baseline justify-between mb-3">
              <p className="text-[18px] font-semibold text-slate-600 uppercase tracking-[0.18em]">
                {c.magnetsAround}
              </p>
              <span className="text-[16px] text-slate-700">{c.significantCount(allFiltered.length)}</span>
            </div>
            <div className="space-y-0">
              {shown.map((m, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 py-2 border-b border-slate-800/30 last:border-0"
                >
                  <span
                    className="mt-0.5 shrink-0 w-6 h-6 flex items-center justify-center rounded text-[14px] font-bold bg-slate-800/60"
                    style={{ color: CATEGORY_COLOR[m.categoryId] }}
                  >
                    {m.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[19px] text-slate-300 leading-snug truncate">{m.name}</p>
                    <p className="text-[15px] text-slate-600 mt-0.5">
                      {(() => {
                        const why = magnetWhy(m.categoryId, locale);
                        return (
                          <>
                            {magnetCategoryLabel(m.categoryId, locale)}
                            {why ? ` · ${why}` : ''}
                          </>
                        );
                      })()}
                    </p>
                  </div>
                  <span className="text-[17px] text-slate-500 shrink-0 tabular-nums mt-0.5">
                    {formatDist(m.distance)}
                  </span>
                </div>
              ))}
            </div>
            {!magnetExpanded && hiddenCount > 0 && (
              <button
                onClick={() => setMagnetExpanded(true)}
                className="mt-3 text-[16px] text-slate-600 hover:text-slate-400 transition-colors"
              >
                {c.showMoreMagnets(hiddenCount)}
              </button>
            )}
            {magnetExpanded && allFiltered.length > MAGNET_DEFAULT_LIMIT && (
              <button
                onClick={() => setMagnetExpanded(false)}
                className="mt-3 text-[16px] text-slate-600 hover:text-slate-400 transition-colors"
              >
                {c.collapse}
              </button>
            )}
          </div>
        );
      })()}

    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function LocationIntelligenceDemo({ locale = 'en' }: { locale?: LocDemoLocale }) {
  const c = LOC_COPY[locale];
  const locTel = useLocationTelemetryOptional();
  const locTelRef = useRef(locTel);
  locTelRef.current = locTel;
  const [selected, setSelected] = useState<SelectedAddress | null>(null);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'result'>('idle');
  const [step, setStep] = useState(0);
  const [analysis, setAnalysis] = useState<LocationAnalysis | null>(null);
  const [analysisMeta, setAnalysisMeta] = useState<AnalysisMeta | null>(null);
  const [animated, setAnimated] = useState(false);
  const [validationErr, setValidationErr] = useState(false);
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) { setValidationErr(true); return; }
    setValidationErr(false);
    locTel?.pushLine({ badge: 'RUN', text: c.runStarted, kind: 'info' });
    setPhase('loading');
    setStep(0);
    setAnalysis(null);
    setAnalysisMeta(null);
    setAnimated(false);
  }

  function reset() {
    setSelected(null);
    setPhase('idle');
    setAnalysis(null);
    setAnalysisMeta(null);
    setAnimated(false);
    setValidationErr(false);
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

    const tickers = c.loadingSteps.map((_, i) =>
      i === 0 ? null : setTimeout(() => { if (!cancelled) setStep(i); }, i * 1000),
    ).filter(Boolean) as ReturnType<typeof setTimeout>[];

    const fetchStart = Date.now();
    fetchLocationAnalysis(selected.lat, selected.lon, controller.signal).then(result => {
      clearTimeout(abortTimeout);
      if (cancelled) return;
      const resolvedAnalysis = result?.analysis ?? buildAnalysis([], selected.lat, selected.lon);
      const resolvedMeta = result?.meta ?? null;
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
      }, Math.max(0, 3000 - elapsed));
    });

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(abortTimeout);
      tickers.forEach(clearTimeout);
    };
  }, [phase, selected, locale, c]);

  return (
    <section className="py-20 sm:py-24 px-4 sm:px-6 border-t border-slate-800/60 bg-slate-950">
      <div className="max-w-5xl mx-auto text-left">

        {/* Section header + marketing — left-aligned, clear hierarchy */}
        <div className="mb-12 max-w-2xl space-y-6">
          <div className="space-y-4">
            <h2 className="text-4xl sm:text-5xl font-bold text-white leading-[1.1] tracking-tight whitespace-pre-line">
              {c.sectionTitle}
            </h2>
            <p className="text-lg sm:text-xl text-slate-400 leading-relaxed whitespace-pre-line">
              {c.sectionLead}
            </p>
          </div>

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

        </div>

        {/* ── RESULT PHASE ── */}
        {phase === 'result' && analysis ? (
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-start">

            {/* Left: OSM map + influence heatmap */}
            <div>
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
                />
              </div>
              <div className="mt-3">
                <p className="text-[20px] text-slate-500 mb-2 truncate">{selected?.value}</p>
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
                      className={`text-[17px] px-2 py-0.5 rounded-full border transition-all cursor-pointer hover:brightness-125 ${
                        activeTag === i
                          ? 'bg-indigo-900/50 text-indigo-300 border-indigo-700/60'
                          : 'bg-slate-800/80 text-slate-500 border-slate-800 hover:text-slate-300 hover:border-slate-600'
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
              </div>

              {/* Influence heatmap — real calculation, not decoration */}
              <div ref={heatmapDivRef}>
                <InfluenceHeatmapPanel
                  analysis={analysis}
                  subjectLat={selected!.lat}
                  subjectLon={selected!.lon}
                  locale={locale}
                  c={c}
                />
              </div>

              <button
                onClick={reset}
                className="mt-5 w-full py-3 px-6 rounded-xl border border-slate-700/80 text-sm text-slate-400 hover:border-slate-600 hover:text-slate-200 hover:bg-slate-800/40 transition-all"
              >
                {c.tryAnother}
              </button>
            </div>

            {/* Right: ASI analysis */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[18px] font-semibold uppercase tracking-[0.22em] text-indigo-400">
                  {c.asiPanelTitle}
                </span>
              </div>
              <ASIPanel
                analysis={analysis}
                address={selected?.value ?? ''}
                animated={animated}
                meta={analysisMeta}
                locale={locale}
                c={c}
              />
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
                    locTel?.pushLine({
                      badge: 'ADR',
                      text: c.addrChosenLog(truncateForLog(addr.value)),
                      kind: 'info',
                    });
                  }}
                  onClear={() => setSelected(null)}
                  disabled={phase === 'loading'}
                  locale={locale}
                  c={c}
                />
                {validationErr && (
                  <p className="text-sm text-rose-400 px-1" role="alert">
                    {c.pickAddressErr}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={phase === 'loading'}
                  className="w-full py-4 px-8 bg-white text-slate-900 font-bold text-base rounded-xl hover:bg-slate-100 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-white/5 hover:shadow-white/10 hover:scale-[1.01] active:scale-[0.99]"
                >
                  {phase === 'loading' ? c.loadingSteps[step] : c.submitIdle}
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
