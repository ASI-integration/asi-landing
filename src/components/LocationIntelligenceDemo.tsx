'use client';

import { useState, useEffect, useRef } from 'react';
import {
  MAGNET_CATEGORIES,
  CATEGORY_MAX_SHOW,
  CATEGORY_COLOR,
  buildAnalysis,
  getBand,
  formatDist,
  projectToSVG,
  patchLegacyLocationAnalysis,
} from '@/lib/location';
import type { LocationAnalysis, Band, AnalysisMeta, FootTrafficModifierTier } from '@/lib/location';

// ── UI-only types ─────────────────────────────────────────────────────────────

interface Suggestion {
  value: string;
  lat: string | null;
  lon: string | null;
}

interface SelectedAddress {
  value: string;
  lat: number;
  lon: number;
}

type SuggestStatus = 'idle' | 'ok' | 'no_results' | 'no_key' | 'error';

// ── Address suggestion fetch ───────────────────────────────────────────────────

async function fetchSuggestions(q: string): Promise<{ suggestions: Suggestion[]; status: SuggestStatus }> {
  try {
    const res = await fetch(`/api/address-suggest?q=${encodeURIComponent(q)}`);
    if (!res.ok) return { suggestions: [], status: 'error' };
    const data = await res.json();
    const suggestions = (data.suggestions ?? []) as Suggestion[];
    const status: SuggestStatus = data.status ?? (suggestions.length > 0 ? 'ok' : 'no_results');
    return { suggestions, status };
  } catch {
    return { suggestions: [], status: 'error' };
  }
}

async function fetchLocationAnalysis(
  lat: number,
  lon: number,
): Promise<{ analysis: LocationAnalysis; meta: AnalysisMeta } | null> {
  try {
    const res = await fetch('/api/location-demo-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lon }),
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

function formatUpdatedRelativeRu(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'Обновлено только что';
  if (m < 60) return `Обновлено ${m} мин. назад`;
  const h = Math.floor(m / 60);
  if (h < 48) return `Обновлено ${h} ч. назад`;
  return `Обновлено ${new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
}

function formatUpdatedAtReadableRu(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function AnalysisFreshnessStrip({ meta }: { meta: AnalysisMeta }) {
  const isStale = meta.freshness === 'stale';
  const refreshing = Boolean(meta.refreshing);
  const fromCache = meta.cached;

  let statusLabel: string;
  let statusClass: string;
  if (refreshing && isStale) {
    statusLabel = 'Данные обновляются';
    statusClass = 'text-amber-400';
  } else if (isStale) {
    statusLabel = 'Снимок не самый свежий';
    statusClass = 'text-slate-400';
  } else {
    statusLabel = 'Данные актуальны';
    statusClass = 'text-emerald-400';
  }

  const sourceKind = fromCache
    ? (refreshing && isStale ? 'кэш (идёт обновление)' : 'кэш')
    : 'свежая выгрузка';
  const baseSource = 'OpenStreetMap';

  return (
    <div className="px-5 py-2.5 border-b border-slate-800/50 bg-slate-950/30">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={`text-[19px] font-semibold ${statusClass}`}>{statusLabel}</span>
        <span className="text-[17px] text-slate-500">{formatUpdatedRelativeRu(meta.updatedAt)}</span>
      </div>
      <p className="mt-1 text-[17px] text-slate-500 leading-snug">
        <span className="text-slate-600">Время снимка: </span>
        {formatUpdatedAtReadableRu(meta.updatedAt)}
      </p>
      <p className="mt-0.5 text-[17px] text-slate-500 leading-snug">
        Источник: {baseSource} · {sourceKind}
        {meta.usedFallbackQuery ? (
          <span className="text-slate-600"> · часть сервисов была недоступна</span>
        ) : null}
      </p>
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

function IdleMapPanel() {
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
          <p className="text-base font-medium text-slate-400">Введите ваш адрес объекта</p>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed">Анализ начнётся после выбора точного адреса из списка</p>
        </div>
      </div>
    </div>
  );
}

// ── OSM Map Panel ─────────────────────────────────────────────────────────────

function OSMMapPanel({ lat, lon, loading }: { lat: number; lon: number; loading: boolean }) {
  const deltaLat = 0.008;
  const deltaLon = 0.014;
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
        title="Карта окружения объекта — OpenStreetMap"
        loading="lazy"
        style={{ display: 'block' }}
      />
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-sm rounded-2xl">
          <div className="w-7 h-7 border-2 border-slate-700 border-t-indigo-400 rounded-full animate-spin mb-4" />
          <p className="text-white font-semibold text-sm">Запрашиваем окружение...</p>
          <p className="mt-1 text-xs text-slate-500">реальные объекты вокруг адреса</p>
        </div>
      )}
    </div>
  );
}

// ── Influence Heatmap Panel ───────────────────────────────────────────────────
// SVG visualization of computed attraction + competitor pressure.
// Every point is derived from real OSM-detected objects and real scores — no decoration.

const SVG_W = 400;
const SVG_H = 280;

function footTrafficTierRu(tier: FootTrafficModifierTier): string {
  if (tier === 'strong') return 'заметное усиление';
  if (tier === 'moderate') return 'умеренное усиление';
  return 'слабое усиление';
}

function InfluenceHeatmapPanel({
  analysis,
  subjectLat,
  subjectLon,
}: {
  analysis: LocationAnalysis;
  subjectLat: number;
  subjectLon: number;
}) {
  const { heatmapPoints, footTraffic } = analysis;

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
          ASI · Карта влияния
        </span>
        <span className="text-[17px] text-slate-700">· реальные значения</span>
      </div>

      {/* SVG heatmap */}
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        width="100%"
        height={SVG_H}
        style={{ display: 'block', background: '#080c14' }}
        aria-label="Карта притяжения локации"
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
          <text x={20} y={20} fill="rgba(148,163,184,0.8)" fontSize="14" fontFamily="inherit">Магниты</text>
          {/* Competitor */}
          <circle cx={12} cy={36} r={4} fill="#f87171" opacity={0.8} />
          <text x={20} y={40} fill="rgba(148,163,184,0.8)" fontSize="14" fontFamily="inherit">Конкуренты</text>
          {/* Subject */}
          <circle cx={12} cy={54} r={3} fill="white" opacity={0.9} />
          <text x={20} y={58} fill="rgba(148,163,184,0.8)" fontSize="14" fontFamily="inherit">Ваш объект</text>
        </g>
      </svg>

      {/* Caption */}
      <div className="px-4 py-2.5 space-y-1">
        <p className="text-[18px] text-slate-500 leading-snug">
          Тепло карты связано с магнитами и зоной: плотность и концентрация у реальных точек притяжения,
          устойчивость потока и то, насколько движение похоже на{' '}
          <span className="text-slate-400">целевой приход</span>, а не только на{' '}
          <span className="text-slate-400">транзит</span>.
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span className="text-[17px] text-slate-700">
            {heatmapPoints.filter(p => p.type === 'magnet').length} магнитов ·{' '}
            {heatmapPoints.filter(p => p.type === 'competitor').length} конкурентов
          </span>
          <span className="text-[17px] text-slate-600">
            активность зоны — {footTraffic.zoneActivityRu} · устойчивость — {footTraffic.flowStabilityRu}
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
}: {
  onSelect: (addr: SelectedAddress) => void;
  onClear: () => void;
  disabled: boolean;
}) {
  const [text, setText] = useState('');
  const [locked, setLocked] = useState(false);
  const [lockedValue, setLockedValue] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [fetching, setFetching] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [suggestStatus, setSuggestStatus] = useState<SuggestStatus>('idle');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setText(val);
    setActiveIdx(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (val.trim().length >= 2) {
      setFetching(true);
      debounceRef.current = setTimeout(async () => {
        const result = await fetchSuggestions(val);
        setSuggestions(result.suggestions);
        setSuggestStatus(result.status);
        setOpen(result.suggestions.length > 0);
        setFetching(false);
      }, 280);
    } else {
      setSuggestions([]);
      setOpen(false);
      setSuggestStatus('idle');
      setFetching(false);
    }
  }

  function pick(s: Suggestion) {
    if (!s.lat || !s.lon) return;
    setLocked(true);
    setLockedValue(s.value);
    setText('');
    setSuggestions([]);
    setOpen(false);
    setSuggestStatus('idle');
    onSelect({ value: s.value, lat: parseFloat(s.lat), lon: parseFloat(s.lon) });
  }

  function clear() {
    setLocked(false);
    setLockedValue('');
    setText('');
    setSuggestions([]);
    setOpen(false);
    setActiveIdx(-1);
    setSuggestStatus('idle');
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
      pick(suggestions[activeIdx]);
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
          <span className="text-[10px] font-semibold text-emerald-500 uppercase tracking-[0.18em]">Точный адрес выбран</span>
        </div>
      )}
      <div className="relative">
        <input
          type="text"
          value={locked ? lockedValue : text}
          onChange={locked ? () => undefined : handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Введите ваш адрес объекта"
          disabled={disabled}
          readOnly={locked}
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-haspopup="listbox"
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
            aria-label="Изменить адрес"
            className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-full text-slate-500 hover:text-slate-300 hover:bg-slate-700/60 transition-all"
          >
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="1" y1="1" x2="8" y2="8" />
              <line x1="8" y1="1" x2="1" y2="8" />
            </svg>
          </button>
        )}
        {!locked && fetching && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-slate-600 border-t-slate-300 rounded-full animate-spin pointer-events-none" />
        )}
      </div>

      {open && suggestions.length > 0 && !locked && (
        <ul
          role="listbox"
          className="absolute z-50 w-full mt-1 rounded-xl border border-slate-700 bg-slate-900/95 backdrop-blur shadow-2xl overflow-y-auto"
          style={{ maxHeight: 260 }}
        >
          {suggestions.map((s, i) => (
            <li
              key={i}
              role="option"
              aria-selected={activeIdx === i}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseDown={e => { e.preventDefault(); pick(s); }}
              className={`px-4 py-3 cursor-pointer text-sm leading-snug transition-colors ${
                activeIdx === i ? 'bg-slate-700/80 text-white' : 'text-slate-300 hover:bg-slate-800/80'
              }`}
            >
              {s.value}
            </li>
          ))}
        </ul>
      )}

      {!locked && !open && !fetching && text.trim().length >= 2 && (
        suggestStatus === 'no_results' ? (
          <p className="mt-1.5 px-1 text-xs text-slate-500">Адрес не найден — попробуйте уточнить запрос</p>
        ) : (suggestStatus === 'no_key' || suggestStatus === 'error') ? (
          <p className="mt-1.5 px-1 text-xs text-slate-500">Подсказки временно недоступны</p>
        ) : null
      )}
    </div>
  );
}

// ── Evergreen ring SVG ────────────────────────────────────────────────────────

const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;
const RING_VB = 120;

function EvergreenRing({ index, band, animated }: { index: number; band: Band; animated: boolean }) {
  const fill = animated ? (index / 100) * RING_C : 0;
  const c = RING_VB / 2;
  return (
    <svg width={RING_VB} height={RING_VB} viewBox={`0 0 ${RING_VB} ${RING_VB}`} className="shrink-0" aria-hidden="true">
      <circle cx={c} cy={c} r={RING_R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
      <circle
        cx={c} cy={c} r={RING_R}
        fill="none"
        stroke={band.stroke}
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${fill} ${RING_C}`}
        transform={`rotate(-90 ${c} ${c})`}
        style={{ transition: animated ? 'stroke-dasharray 1.0s cubic-bezier(0.4,0,0.2,1)' : 'none' }}
      />
      <text x={c} y={c - 8} textAnchor="middle" fill="white" fontSize="38" fontWeight="700" fontFamily="inherit">
        {index > 0 ? index : '—'}
      </text>
      <text x={c} y={c + 14} textAnchor="middle" fill="rgb(100,116,139)" fontSize="15" fontFamily="inherit">
        Индекс вечной
      </text>
      <text x={c} y={c + 34} textAnchor="middle" fill="rgb(100,116,139)" fontSize="15" fontFamily="inherit">
        локации
      </text>
    </svg>
  );
}

// ── ASI results panel ─────────────────────────────────────────────────────────

function ASIPanel({
  analysis,
  address,
  animated,
  meta,
}: {
  analysis: LocationAnalysis;
  address: string;
  animated: boolean;
  meta: AnalysisMeta | null;
}) {
  const {
    magnets, magnetCountByCategory, competitors, evergreenIndex, conclusion, gravityExplanation,
    accessibilityStops, footTraffic,
  } = analysis;
  const band = getBand(evergreenIndex);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(t);
  }, []);

  const magnetGroups: Record<string, typeof magnets> = {};
  for (const m of magnets) {
    if (!magnetGroups[m.categoryId]) magnetGroups[m.categoryId] = [];
    magnetGroups[m.categoryId].push(m);
  }

  const hasMagnets = magnets.length > 0;
  const hasCompetitors = competitors.length > 0;

  return (
    <div
      className={`rounded-2xl border ${band.border} ${band.bg} overflow-hidden`}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(10px)',
        transition: 'opacity 0.4s ease, transform 0.4s ease',
      }}
    >
      {meta ? <AnalysisFreshnessStrip meta={meta} /> : null}
      {/* Header: index ring + verdict */}
      <div className="p-5 flex items-center gap-4 border-b border-slate-800/60">
        <EvergreenRing index={evergreenIndex} band={band} animated={animated} />
        <div className="min-w-0">
          <p className="text-[18px] font-semibold text-slate-500 uppercase tracking-[0.2em] mb-1">Итог анализа</p>
          <p className={`text-4xl font-bold leading-tight ${band.textColor}`}>{band.label}</p>
          {conclusion && (
            <p className="mt-2 text-[22px] text-slate-400 leading-snug">{conclusion}</p>
          )}
          <p
            className="mt-2 text-[18px] text-slate-600 leading-snug"
            style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
            title={address}
          >
            {address}
          </p>
        </div>
      </div>

      {/* Gravity insight */}
      {hasMagnets && gravityExplanation.dominantMagnets.length > 0 && (
        <div className="px-5 pt-4 pb-3 border-b border-slate-800/40">
          <p className="text-[18px] font-semibold text-slate-600 uppercase tracking-[0.18em] mb-2.5">
            Анализ притяжения
          </p>
          <div className="space-y-2">
            {gravityExplanation.strongestZoneLabel && (
              <div className="flex items-baseline gap-2">
                <span className="text-[18px] text-slate-600 shrink-0 w-48">Ключевая зона</span>
                <span className="text-[20px] text-slate-300">{gravityExplanation.strongestZoneLabel}</span>
              </div>
            )}
            {gravityExplanation.dominantMagnets[0] && (
              <div className="flex items-baseline gap-2">
                <span className="text-[18px] text-slate-600 shrink-0 w-48">Главный магнит</span>
                <span className="text-[20px] text-slate-300 truncate" style={{ maxWidth: 260 }}>
                  {gravityExplanation.dominantMagnets[0]}
                </span>
              </div>
            )}
            <div className="flex items-baseline gap-2">
              <span className="text-[18px] text-slate-600 shrink-0 w-48">Давление конкурентов</span>
              <span className={`text-[20px] font-medium ${
                gravityExplanation.competitorPressureLevel === 'высокое' ? 'text-rose-400'
                : gravityExplanation.competitorPressureLevel === 'среднее' ? 'text-amber-400'
                : 'text-emerald-400'
              }`}>
                {gravityExplanation.competitorPressureLevel}
              </span>
            </div>
            {gravityExplanation.clusterDetected && (
              <div className="flex items-baseline gap-2">
                <span className="text-[18px] text-slate-600 shrink-0 w-48">Зона спроса</span>
                <span className="text-[20px] text-slate-300">
                  кластер · {gravityExplanation.clusterSize} объектов рядом
                </span>
              </div>
            )}
            {gravityExplanation.demandDistribution === 'split' && (
              <div className="flex items-baseline gap-2">
                <span className="text-[18px] text-slate-600 shrink-0 w-48">Распределение</span>
                <span className="text-[20px] text-slate-400">спрос разделён между зонами</span>
              </div>
            )}
          </div>
        </div>
      )}

      {hasMagnets && (
        <div className="px-5 pt-4 pb-3 border-b border-slate-800/40">
          <p className="text-[18px] font-semibold text-slate-600 uppercase tracking-[0.18em] mb-2.5">
            Поток людей вокруг объекта
          </p>
          <p className="text-[17px] text-slate-500 leading-snug mb-3">
            Оценка не строится на «голом» трафике: движение усиливает индекс только там, где уже есть
            убедительные магниты — при сильном транзите без целевого прихода усиление остаётся скромным.
          </p>
          <div className="space-y-2">
            <div className="flex items-baseline gap-2">
              <span className="text-[18px] text-slate-600 shrink-0 w-48">Плотность движения</span>
              <span className="text-[20px] text-slate-300">{footTraffic.movementDensityRu}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-[18px] text-slate-600 shrink-0 w-48">Активность зоны</span>
              <span className="text-[20px] text-slate-300">{footTraffic.zoneActivityRu}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-[18px] text-slate-600 shrink-0 w-48">Устойчивость потока</span>
              <span className="text-[20px] text-slate-300">{footTraffic.flowStabilityRu}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-[18px] text-slate-600 shrink-0 w-48">Целевой и транзитный поток</span>
              <span className="text-[20px] text-slate-300">{footTraffic.flowCharacterRu}</span>
            </div>
            <div className="flex items-baseline gap-2 pt-1">
              <span className="text-[18px] text-slate-600 shrink-0 w-48">Вклад в индекс</span>
              <span className="text-[20px] text-slate-300">
                {gravityExplanation.scoreBreakdown.trafficBoost > 0
                  ? `+${gravityExplanation.scoreBreakdown.trafficBoost} · ${footTrafficTierRu(footTraffic.modifierTier)}`
                  : `нет · ${footTrafficTierRu(footTraffic.modifierTier)}`}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Magnets */}
      {hasMagnets && (
        <div className="px-5 pt-4 pb-3">
          <p className="text-[18px] font-semibold text-slate-600 uppercase tracking-[0.18em] mb-3">
            Магниты вокруг объекта
          </p>
          <div className="space-y-4">
            {MAGNET_CATEGORIES.map(cat => {
              const items = magnetGroups[cat.id];
              const totalCount = magnetCountByCategory[cat.id] ?? 0;
              if (!items || items.length === 0) return null;
              return (
                <div key={cat.id}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className="text-[18px] font-mono font-bold text-slate-600 bg-slate-800/60 px-2 py-0.5 rounded"
                      style={{ color: CATEGORY_COLOR[cat.id] }}
                    >
                      {cat.icon}
                    </span>
                    <span className="text-[20px] font-semibold text-slate-400">{cat.label}</span>
                    {totalCount > (CATEGORY_MAX_SHOW[cat.id] ?? 3) && (
                      <span className="text-[17px] text-slate-700 ml-0.5">
                        +{totalCount - (CATEGORY_MAX_SHOW[cat.id] ?? 3)} ещё
                      </span>
                    )}
                    <span className="ml-auto text-[17px] text-slate-700">вес {cat.weight}</span>
                  </div>
                  {items.map((m, i) => (
                    <div key={i} className="flex items-center justify-between pl-5 py-1">
                      <span className="text-[20px] text-slate-400 truncate mr-2" style={{ maxWidth: 300 }}>
                        {m.name}
                      </span>
                      <span className="text-[20px] text-slate-500 shrink-0 tabular-nums">
                        {formatDist(m.distance)}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {accessibilityStops.length > 0 && (
        <div className="px-5 pt-3 pb-3 border-t border-slate-800/40">
          <p className="text-[18px] font-semibold text-slate-600 uppercase tracking-[0.18em] mb-2">
            Остановки и платформы
          </p>
          <p className="text-[17px] text-slate-500 leading-snug mb-3">
            Учитываются как слабый модификатор доступности, а не как магниты годового спроса в модели ASI.
          </p>
          <div className="space-y-1">
            {accessibilityStops.map((s, i) => (
              <div key={i} className="flex items-center justify-between pl-1 py-0.5">
                <span className="text-[19px] text-slate-400 truncate mr-2" style={{ maxWidth: 300 }}>{s.name}</span>
                <span className="text-[19px] text-slate-500 shrink-0 tabular-nums">{formatDist(s.distance)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Competitors */}
      {hasCompetitors && (
        <div className="px-5 pt-3 pb-4 border-t border-slate-800/40">
          <p className="text-[18px] font-semibold text-slate-600 uppercase tracking-[0.18em] mb-3">
            Конкуренты в окружении
          </p>
          <div className="flex gap-5 mb-3">
            <div>
              <p className="text-3xl font-bold text-slate-200 tabular-nums">{competitors.length}</p>
              <p className="text-[17px] text-slate-500 mt-0.5">всего</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-slate-200 tabular-nums">
                {competitors.filter(c => c.distance <= 500).length}
              </p>
              <p className="text-[17px] text-slate-500 mt-0.5">в 500 м</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-slate-200 tabular-nums">
                {formatDist(Math.round(competitors.reduce((s, c) => s + c.distance, 0) / competitors.length))}
              </p>
              <p className="text-[17px] text-slate-500 mt-0.5">ср. расстояние</p>
            </div>
          </div>
          <div className="space-y-1">
            {competitors.slice(0, 5).map((c, i) => (
              <div key={i} className="flex items-center justify-between py-0.5">
                <span className="text-[20px] text-slate-400 truncate mr-2" style={{ maxWidth: 300 }}>{c.name}</span>
                <span className="text-[20px] text-slate-500 shrink-0 tabular-nums">{formatDist(c.distance)}</span>
              </div>
            ))}
            {competitors.length > 5 && (
              <p className="text-[18px] text-slate-700 mt-1">+{competitors.length - 5} ещё</p>
            )}
          </div>
        </div>
      )}

      {!hasMagnets && !hasCompetitors && accessibilityStops.length === 0 && (
        <div className="px-5 py-4">
          <p className="text-[22px] text-slate-600">
            По этому адресу объектов в базе OpenStreetMap не найдено.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Loading steps ─────────────────────────────────────────────────────────────

const LOADING_STEPS = [
  'Запрашиваем окружение...',
  'Рассчитываем притяжение...',
  'Анализируем конкурентов...',
  'Соотносим поток людей с магнитами...',
];

// ── Main export ───────────────────────────────────────────────────────────────

export function LocationIntelligenceDemo() {
  const [selected, setSelected] = useState<SelectedAddress | null>(null);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'result'>('idle');
  const [step, setStep] = useState(0);
  const [analysis, setAnalysis] = useState<LocationAnalysis | null>(null);
  const [analysisMeta, setAnalysisMeta] = useState<AnalysisMeta | null>(null);
  const [animated, setAnimated] = useState(false);
  const [validationErr, setValidationErr] = useState(false);
  const [inputKey, setInputKey] = useState(0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) { setValidationErr(true); return; }
    setValidationErr(false);
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
  }

  // Loading: step ticker + server-side OSM fetch + analysis
  useEffect(() => {
    if (phase !== 'loading' || !selected) return;
    let cancelled = false;

    const tickers = LOADING_STEPS.map((_, i) =>
      i === 0 ? null : setTimeout(() => { if (!cancelled) setStep(i); }, i * 900),
    ).filter(Boolean) as ReturnType<typeof setTimeout>[];

    const fetchStart = Date.now();
    fetchLocationAnalysis(selected.lat, selected.lon).then(result => {
      if (cancelled) return;
      const resolvedAnalysis = result?.analysis ?? buildAnalysis([], selected.lat, selected.lon);
      const resolvedMeta = result?.meta ?? null;
      const elapsed = Date.now() - fetchStart;
      setTimeout(() => {
        if (cancelled) return;
        setAnalysis(resolvedAnalysis);
        setAnalysisMeta(resolvedMeta);
        setPhase('result');
        setTimeout(() => { if (!cancelled) setAnimated(true); }, 80);
      }, Math.max(0, 2500 - elapsed));
    });

    return () => {
      cancelled = true;
      tickers.forEach(clearTimeout);
    };
  }, [phase, selected]);

  return (
    <section className="py-20 sm:py-24 px-4 sm:px-6 border-t border-slate-800/60 bg-slate-950">
      <div className="max-w-5xl mx-auto text-left">

        {/* Section header + marketing — left-aligned, clear hierarchy */}
        <div className="mb-12 max-w-2xl space-y-6">
          <div className="space-y-4">
            <h2 className="text-4xl sm:text-5xl font-bold text-white leading-[1.1] tracking-tight">
              Система понимает потенциал вашего объекта
            </h2>
            <p className="text-lg sm:text-xl text-slate-400 leading-relaxed">
              Введите ваш адрес — и посмотрите, как ASI оценивает локацию: магниты, конкурентов и индекс вечной локации.
            </p>
          </div>

          <div className="space-y-3 pt-2 border-t border-slate-800/80">
            <p className="text-xl sm:text-2xl font-semibold text-slate-100 leading-snug">
              Алгоритмы ASI просчитывают не просто поток людей, а целевой спрос.
            </p>
            <p className="text-base sm:text-lg text-slate-400 leading-relaxed">
              То есть показывают, где у людей есть реальная причина ехать, останавливаться и бронировать именно ваш объект.
            </p>
          </div>
        </div>

        {/* ── RESULT PHASE ── */}
        {phase === 'result' && analysis ? (
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-start">

            {/* Left: OSM map + influence heatmap */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[18px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                  Карта окружения
                </span>
                <span className="text-[17px] text-slate-700">· OpenStreetMap</span>
              </div>
              <OSMMapPanel lat={selected!.lat} lon={selected!.lon} loading={false} />
              <div className="mt-3">
                <p className="text-[20px] text-slate-500 mb-2 truncate">{selected?.value}</p>
                <div className="flex flex-wrap gap-1.5">
                  {['Объект на карте', 'Транспорт', 'Объекты вокруг', 'Реальная карта'].map(tag => (
                    <span key={tag} className="text-[17px] px-2 py-0.5 rounded-full bg-slate-800/80 text-slate-500 border border-slate-800">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* Influence heatmap — real calculation, not decoration */}
              <InfluenceHeatmapPanel
                analysis={analysis}
                subjectLat={selected!.lat}
                subjectLon={selected!.lon}
              />

              <button
                onClick={reset}
                className="mt-5 w-full py-3 px-6 rounded-xl border border-slate-700/80 text-sm text-slate-400 hover:border-slate-600 hover:text-slate-200 hover:bg-slate-800/40 transition-all"
              >
                Проверить другой адрес
              </button>
            </div>

            {/* Right: ASI analysis */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[18px] font-semibold uppercase tracking-[0.22em] text-indigo-400">
                  ASI · Анализ локации
                </span>
              </div>
              <ASIPanel
                analysis={analysis}
                address={selected?.value ?? ''}
                animated={animated}
                meta={analysisMeta}
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
                  onSelect={addr => { setSelected(addr); setValidationErr(false); }}
                  onClear={() => setSelected(null)}
                  disabled={phase === 'loading'}
                />
                {validationErr && (
                  <p className="text-sm text-rose-400 px-1" role="alert">
                    Выберите точный адрес из списка
                  </p>
                )}
                <button
                  type="submit"
                  disabled={phase === 'loading'}
                  className="w-full py-4 px-8 bg-white text-slate-900 font-bold text-base rounded-xl hover:bg-slate-100 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-white/5 hover:shadow-white/10 hover:scale-[1.01] active:scale-[0.99]"
                >
                  {phase === 'loading' ? LOADING_STEPS[step] : 'Рассчитать локацию'}
                </button>
              </form>
              {phase === 'idle' && (
                <p className="mt-5 text-xs text-slate-600">
                  Используются реальные данные OpenStreetMap
                </p>
              )}
            </div>

            {/* Right: map */}
            <div>
              {selected ? (
                <OSMMapPanel lat={selected.lat} lon={selected.lon} loading={phase === 'loading'} />
              ) : (
                <IdleMapPanel />
              )}
            </div>

          </div>
        )}

        {/* Attribution */}
        <p className="mt-10 text-[11px] text-slate-500 text-center leading-relaxed max-w-lg mx-auto">
          Методика ASI построена на логике оценки локации, изученной в курсе Ярослава Стригунова, и адаптирована под автоматизированный расчёт.
        </p>

      </div>
    </section>
  );
}
