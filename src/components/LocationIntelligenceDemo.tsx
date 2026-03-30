'use client';

import { useState, useEffect, useRef } from 'react';
import { AsiCat } from './AsiCat';
import type { Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// ── types ─────────────────────────────────────────────────────────────────────

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

// ── deterministic score helpers ───────────────────────────────────────────────

function simpleHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) & 0x7fffffff;
  }
  return h || 1;
}

function lcg(n: number): number {
  return (n * 48271) % 2147483647;
}

/** Score is deterministic from the selected address value string */
function scoreAddress(value: string): number {
  return 42 + (simpleHash(value.trim().toLowerCase()) % 55);
}

interface Metric { label: string; value: number }

function deriveMetrics(score: number, h: number): Metric[] {
  const LABELS = [
    'Транспортная доступность',
    'Плотность спроса',
    'Конкурентная активность',
    'Соответствие аудитории',
    'Притяжение района',
  ];
  let s = h;
  return LABELS.map(label => {
    s = lcg(s);
    const delta = (s % 25) - 12;
    return { label, value: Math.max(22, Math.min(97, score + delta)) };
  });
}

interface AudienceScore { label: string; value: number }

const FACTOR_SUBLABELS: Record<string, string> = {
  'Транспортная доступность': 'насколько удобно добираться',
  'Плотность спроса': 'насколько активен спрос вокруг точки',
  'Конкурентная активность': 'насколько насыщено окружение похожими объектами',
  'Соответствие аудитории': 'насколько локация подходит под целевой сегмент',
  'Притяжение района': 'насколько сам район создаёт поток',
};

function deriveAudienceScores(score: number, metrics: Metric[], h: number): AudienceScore[] {
  const transport   = metrics[0]?.value ?? score;
  const demand      = metrics[1]?.value ?? score;
  const competition = metrics[2]?.value ?? score;
  const audience    = metrics[3]?.value ?? score;
  const district    = metrics[4]?.value ?? score;

  let s = lcg(h ^ 0x5a3c);
  const n1 = (s % 11) - 5; s = lcg(s);
  const n2 = (s % 11) - 5; s = lcg(s);
  const n3 = (s % 11) - 5; s = lcg(s);
  const n4 = (s % 11) - 5;

  const cl = (v: number) => Math.max(18, Math.min(97, Math.round(v)));

  return [
    { label: 'Командированные / B2B', value: cl(transport * 0.45 + audience * 0.35 + score * 0.20 + n1) },
    { label: 'Бизнес-поездки',        value: cl(transport * 0.40 + demand * 0.30 + score * 0.20 + audience * 0.10 + n2) },
    { label: 'Туристы',               value: cl(district * 0.45 + demand * 0.25 + (100 - competition) * 0.15 + score * 0.15 + n3) },
    { label: 'Семьи',                 value: cl(district * 0.40 + (100 - competition) * 0.25 + (100 - transport) * 0.10 + score * 0.15 + demand * 0.10 + n4) },
  ];
}

function getTopAudienceHint(audienceScores: AudienceScore[]): string {
  if (!audienceScores.length) return '';
  const sorted = [...audienceScores].sort((a, b) => b.value - a.value);
  const top = sorted[0];
  const second = sorted[1];
  if (second && second.value >= top.value - 8) {
    return `Сильнее всего: ${top.label} и ${second.label}`;
  }
  return `Сильнее всего: ${top.label}`;
}

type Band = {
  label: string; desc: string; textColor: string; stroke: string;
  border: string; bg: string; bar: string;
};

function getBand(score: number): Band {
  if (score >= 70) return {
    label: 'Сильная локация',
    desc: 'Высокий спрос, развитая инфраструктура, хорошая видимость.',
    textColor: 'text-emerald-400', stroke: '#34d399',
    border: 'border-emerald-700/40', bg: 'bg-emerald-900/10', bar: 'bg-emerald-500',
  };
  if (score >= 45) return {
    label: 'Средняя локация',
    desc: 'Умеренный потенциал. Есть пространство для усиления.',
    textColor: 'text-amber-400', stroke: '#fbbf24',
    border: 'border-amber-700/40', bg: 'bg-amber-900/10', bar: 'bg-amber-500',
  };
  return {
    label: 'Требует усиления',
    desc: 'Спрос ограничен. Рекомендуется усиление каналами и упаковкой.',
    textColor: 'text-rose-400', stroke: '#f87171',
    border: 'border-rose-700/40', bg: 'bg-rose-900/10', bar: 'bg-rose-500',
  };
}

interface Insights { reasons: string[]; audiences: string[]; actions: string[] }

function deriveInsights(score: number, metrics: Metric[]): Insights {
  const transport   = metrics[0]?.value ?? score;
  const demand      = metrics[1]?.value ?? score;
  const competition = metrics[2]?.value ?? score;
  const audience    = metrics[3]?.value ?? score;
  const district    = metrics[4]?.value ?? score;

  const reasons: string[] = [];
  reasons.push(transport >= 65
    ? 'У точки хорошая транспортная связность'
    : 'Транспортная доступность требует учёта в стратегии');
  reasons.push(demand >= 65
    ? 'Высокая плотность спроса в окружении'
    : demand >= 45
      ? 'Окружение поддерживает смешанный спрос'
      : 'Спрос в зоне ниже среднего');
  reasons.push(competition >= 65
    ? 'Плотность конкурентного окружения выше средней'
    : 'Конкурентное давление в районе умеренное');
  reasons.push(district >= 60
    ? 'Район генерирует стабильный поток посетителей'
    : 'Локация подходит для точечного позиционирования');

  const audiences: string[] = [];
  if (score >= 70 && audience >= 65) {
    audiences.push('Командированные и деловые поездки');
    audiences.push('Смешанный поток: бизнес + туристы');
  } else if (score >= 70) {
    audiences.push('Смешанный поток: бизнес + туристы');
    audiences.push('Краткосрочные городские поездки');
  } else if (score >= 45) {
    audiences.push('Краткосрочные городские поездки');
    audiences.push('Смешанный поток: бизнес + туристы');
    audiences.push('Требуется более точная упаковка под аудиторию');
  } else {
    audiences.push('Нишевые сегменты при правильном позиционировании');
    audiences.push('Требуется более точная упаковка под аудиторию');
  }

  const actions: string[] = [];
  if (score >= 70) {
    actions.push('Оптимизировать карточку объекта');
    actions.push('Подключить правильные каналы продаж');
    actions.push(audience >= 65
      ? 'Усилить упаковку под деловую аудиторию'
      : 'Точнее настроить целевую аудиторию');
  } else if (score >= 45) {
    actions.push('Усилить упаковку объекта');
    actions.push('Точнее настроить целевую аудиторию');
    actions.push('Подключить правильные каналы продаж');
  } else {
    actions.push('Переработать позиционирование объекта');
    actions.push('Усилить упаковку и карточку');
    actions.push('Настроить каналы продаж');
    actions.push('Уточнить целевую аудиторию');
  }

  return { reasons, audiences, actions };
}

// ── constants ─────────────────────────────────────────────────────────────────

const LOADING_STEPS = [
  'Анализируем локацию...',
  'Собираем сигналы...',
  'Строим карту спроса...',
];

const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;

// ── address suggestions fetch ─────────────────────────────────────────────────

type SuggestStatus = 'idle' | 'ok' | 'no_results' | 'no_key' | 'error';
interface SuggestResult { suggestions: Suggestion[]; status: SuggestStatus }

async function fetchSuggestions(q: string): Promise<SuggestResult> {
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

// ── decorative blobs for idle map ─────────────────────────────────────────────

const BLOBS = [
  { top: 28, left: 24, size: 130, op: 0.18 },
  { top: 52, left: 60, size: 160, op: 0.14 },
  { top: 18, left: 70, size: 90,  op: 0.22 },
  { top: 72, left: 38, size: 110, op: 0.11 },
  { top: 62, left: 78, size: 75,  op: 0.16 },
];

// Pool of 16 possible dot positions — randomly cycle to avoid repetition
const DOT_POOL = [
  { top: 14, left: 12 }, { top: 11, left: 35 }, { top: 18, left: 58 }, { top: 12, left: 80 },
  { top: 34, left: 22 }, { top: 40, left: 48 }, { top: 37, left: 72 }, { top: 31, left: 90 },
  { top: 58, left: 15 }, { top: 62, left: 40 }, { top: 55, left: 65 }, { top: 61, left: 85 },
  { top: 80, left: 28 }, { top: 76, left: 52 }, { top: 83, left: 74 }, { top: 78, left: 92 },
];

// ── IdleMapPanel — shown before any address is selected ───────────────────────

function IdleMapPanel() {
  const [activeDots, setActiveDots] = useState<number[]>([]);

  useEffect(() => {
    function pick() {
      const count = 2 + Math.floor(Math.random() * 3); // 2–4 dots
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
      style={{ height: 340 }}
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), ' +
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
              opacity: b.op,
              filter: 'blur(22px)',
              transform: 'translate(-50%, -50%)',
            }}
          />
        ))}
      </div>
      {/* Dots at random positions from pool */}
      {DOT_POOL.map((d, i) => {
        const isActive = activeDots.includes(i);
        return (
          <span
            key={i}
            className="absolute rounded-full pointer-events-none"
            style={{
              top: `${d.top}%`, left: `${d.left}%`,
              width: isActive ? 7 : 4,
              height: isActive ? 7 : 4,
              transform: 'translate(-50%, -50%)',
              background: isActive ? '#818cf8' : '#1e293b',
              boxShadow: isActive ? '0 0 10px 4px rgba(99,102,241,0.35)' : 'none',
              opacity: isActive ? 0.9 : 0.25,
              transition: 'all 0.5s ease',
            }}
          />
        );
      })}
      {/* Pulse rings on active dots */}
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
              <path d="M9 1.5C6.1 1.5 3.75 3.85 3.75 6.75c0 4.22 5.25 9.75 5.25 9.75s5.25-5.53 5.25-9.75C14.25 3.85 11.9 1.5 9 1.5zm0 7a2.25 2.25 0 110-4.5 2.25 2.25 0 010 4.5z" fill="rgba(99,102,241,0.45)"/>
            </svg>
          </div>
          <p className="text-sm font-medium text-slate-500">Введите адрес объекта</p>
          <p className="mt-1.5 text-xs text-slate-700 leading-snug">Анализ начнётся после выбора<br/>точного адреса из списка</p>
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 p-4 flex items-end justify-end">
        <p className="text-xs text-slate-800 font-mono">ASI · spatial engine</p>
      </div>
    </div>
  );
}

// ── RealMapPanel — MapLibre GL map centered on selected address ────────────────

function RealMapPanel({ lat, lon }: { lat: number; lon: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  useEffect(() => {
    let dead = false;
    if (!containerRef.current) return;

    import('maplibre-gl').then(({ Map, Marker }) => {
      if (dead || !containerRef.current) return;

      const map = new Map({
        container: containerRef.current,
        // OpenFreeMap: free OSM-derived vector tiles, no API key required
        // Attribution: © OpenStreetMap contributors, © OpenFreeMap
        style: 'https://tiles.openfreemap.org/styles/liberty',
        center: [lon, lat],
        zoom: 15,
        attributionControl: { compact: true },
      });

      new Marker({ color: '#818cf8' })
        .setLngLat([lon, lat])
        .addTo(map);

      mapRef.current = map;
    });

    return () => {
      dead = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [lat, lon]);

  return (
    <div
      ref={containerRef}
      className="w-full rounded-2xl border border-slate-800 overflow-hidden"
      style={{ height: 340 }}
    />
  );
}

// ── AddressInput — suggestion combobox ────────────────────────────────────────

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

  // Close dropdown when clicking outside
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
            <path d="M1.5 5.5L4.5 8.5L9.5 2.5" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
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
          placeholder="Введите адрес объекта"
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

        {/* Check icon inside locked input */}
        {locked && (
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
              <circle cx="7.5" cy="7.5" r="7" stroke="#34d399" strokeOpacity="0.35"/>
              <path d="M4.5 7.5L6.5 9.5L10.5 5.5" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        )}

        {/* Clear button — only when locked and not disabled */}
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

        {/* Loading spinner while fetching suggestions */}
        {!locked && fetching && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-slate-600 border-t-slate-300 rounded-full animate-spin pointer-events-none" />
        )}
      </div>

      {/* Suggestions dropdown */}
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
                activeIdx === i
                  ? 'bg-slate-700/80 text-white'
                  : 'text-slate-300 hover:bg-slate-800/80'
              }`}
            >
              {s.value}
            </li>
          ))}
        </ul>
      )}

      {/* Helper / error text */}
      {!locked && !open && !fetching && text.trim().length >= 2 && (
        suggestStatus === 'no_results' ? (
          <p className="mt-1.5 px-1 text-xs text-slate-500">
            Адрес не найден — попробуйте уточнить запрос
          </p>
        ) : suggestStatus === 'no_key' || suggestStatus === 'error' ? (
          <p className="mt-1.5 px-1 text-xs text-slate-500">
            Подсказки временно недоступны
          </p>
        ) : null
      )}
    </div>
  );
}

// ── ResultCard ────────────────────────────────────────────────────────────────

function ResultCard({
  address, score, band, metrics, audienceScores,
}: {
  address: string;
  score: number;
  band: Band;
  metrics: Metric[];
  audienceScores: AudienceScore[];
}) {
  const [animated, setAnimated] = useState(false);
  const [entryVisible, setEntryVisible] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setEntryVisible(true), 30);
    const t2 = setTimeout(() => setAnimated(true), 100);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const dashFill = animated ? (score / 100) * RING_C : 0;

  return (
    <div
      className={`rounded-2xl border ${band.border} ${band.bg} overflow-hidden`}
      style={{
        opacity: entryVisible ? 1 : 0,
        transform: entryVisible ? 'translateY(0)' : 'translateY(10px)',
        transition: 'opacity 0.45s ease, transform 0.45s ease',
      }}
    >
      <div className="p-5 sm:p-6 flex items-center gap-5 border-b border-slate-800/60">
        <svg
          width="116" height="116" viewBox="0 0 116 116"
          className="shrink-0" aria-hidden="true"
        >
          <circle
            cx="58" cy="58" r={RING_R}
            fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7"
          />
          <circle
            cx="58" cy="58" r={RING_R}
            fill="none"
            stroke={band.stroke}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={`${dashFill} ${RING_C}`}
            transform="rotate(-90 58 58)"
            style={{
              transition: animated
                ? 'stroke-dasharray 0.95s cubic-bezier(0.4,0,0.2,1)'
                : 'none',
            }}
          />
          <text
            x="58" y="53" textAnchor="middle"
            fill="white" fontSize="22" fontWeight="700" fontFamily="inherit"
          >
            {score}
          </text>
          <text
            x="58" y="69" textAnchor="middle"
            fill="rgb(100,116,139)" fontSize="9" fontFamily="inherit"
          >
            Индекс локации
          </text>
        </svg>

        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-[0.2em] mb-2">Итог анализа</p>
          <p className={`text-xl sm:text-2xl font-bold leading-tight ${band.textColor}`}>
            {band.label}
          </p>
          <p className="mt-2 text-sm text-slate-400 leading-snug">{band.desc}</p>
          {audienceScores.length > 0 && (
            <p className="mt-1.5 text-[10px] text-slate-500 leading-snug">
              {getTopAudienceHint(audienceScores)}
            </p>
          )}
          <p
            className="mt-3 text-xs text-slate-500 leading-snug"
            style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
          >
            {address}
          </p>
        </div>
      </div>

      <div className="px-5 pt-4 pb-0">
        <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-[0.18em]">Факторы локации</p>
      </div>
      <div className="px-5 pb-5 pt-3.5 space-y-3.5">
        {metrics.map(m => (
          <div key={m.label}>
            <div className="flex justify-between mb-1">
              <div>
                <span className="text-xs text-slate-400">{m.label}</span>
                {FACTOR_SUBLABELS[m.label] && (
                  <span className="block text-[10px] text-slate-600 leading-tight mt-0.5">
                    {FACTOR_SUBLABELS[m.label]}
                  </span>
                )}
              </div>
              <span className="text-xs font-semibold text-slate-300 self-start ml-3 shrink-0">{m.value}</span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-800/80 mt-1.5">
              <div
                className={`h-full rounded-full ${band.bar}`}
                style={{
                  width: animated ? `${m.value}%` : '0%',
                  transition: animated
                    ? 'width 0.85s cubic-bezier(0.4,0,0.2,1)'
                    : 'none',
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {audienceScores.length > 0 && (
        <>
          <div className="px-5 pt-3 pb-0 border-t border-slate-800/60">
            <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-[0.18em]">Подходит для аудиторий</p>
          </div>
          <div className="px-5 pb-5 pt-3.5 space-y-3">
            {audienceScores.map(a => (
              <div key={a.label}>
                <div className="flex justify-between mb-1.5">
                  <span className="text-xs text-slate-400">{a.label}</span>
                  <span className="text-xs font-semibold text-slate-300">{a.value}</span>
                </div>
                <div className="h-1 rounded-full bg-slate-800/80">
                  <div
                    className={`h-full rounded-full ${band.bar} opacity-70`}
                    style={{
                      width: animated ? `${a.value}%` : '0%',
                      transition: animated
                        ? 'width 1.05s cubic-bezier(0.4,0,0.2,1)'
                        : 'none',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Location limitations layer ────────────────────────────────────────────────

interface Limitations { understandings: string[]; conclusion: string }

function deriveLimitations(score: number): Limitations {
  if (score >= 70) {
    return {
      understandings: [
        'Локация сама создаёт спрос — упаковка усиливает уже сильную базу',
        'Высокий потенциал здесь реализуется при правильной стратегии и каналах',
      ],
      conclusion: 'Подходит для краткосрочной аренды как сильная самостоятельная точка',
    };
  }
  if (score >= 45) {
    return {
      understandings: [
        'Результат здесь во многом определяется стратегией и упаковкой, а не только локацией',
        'Потенциал есть, но не реализуется автоматически — важно точное позиционирование',
      ],
      conclusion: 'Может работать в краткосроке при точной настройке аудитории и каналов',
    };
  }
  return {
    understandings: [
      'Потенциал этой точки ограничен самой локацией',
      'Даже при хорошей упаковке результат здесь имеет предел — это важно учитывать в ожиданиях',
    ],
    conclusion: 'Для части объектов здесь разумнее рассмотреть долгосрочную или смешанную модель',
  };
}

// ── InsightPanel ──────────────────────────────────────────────────────────────

function InsightPanel({ score, metrics }: { score: number; metrics: Metric[] }) {
  const { reasons, audiences, actions } = deriveInsights(score, metrics);
  const { understandings, conclusion } = deriveLimitations(score);
  const band = getBand(score);

  const blocks = [
    { title: 'Почему система оценила локацию так', items: reasons, dot: 'bg-slate-400' },
    { title: 'Кому подходит эта локация', items: audiences, dot: 'bg-indigo-400' },
    { title: 'Что усилит результат', items: actions, dot: 'bg-emerald-400' },
  ];

  return (
    <div className="mt-14 pt-10 border-t border-slate-800/60">
      <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-[0.22em] mb-7">Детальный анализ</p>
      <div className="grid sm:grid-cols-3 gap-5">
        {blocks.map(block => (
          <div
            key={block.title}
            className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"
          >
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.18em] mb-4 leading-tight">
              {block.title}
            </p>
            <ul className="space-y-2.5">
              {block.items.map(item => (
                <li key={item} className="flex items-start gap-2.5">
                  <span className={`mt-[5px] w-1.5 h-1.5 rounded-full shrink-0 ${block.dot}`} />
                  <span className="text-sm text-slate-300 leading-snug">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Honest location limitations layer */}
      <div className="mt-5 grid sm:grid-cols-2 gap-5">
        <div className={`rounded-xl border ${band.border} bg-slate-900/60 p-5`}>
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.18em] mb-4 leading-tight">
            Что важно понимать
          </p>
          <ul className="space-y-2.5">
            {understandings.map(item => (
              <li key={item} className="flex items-start gap-2.5">
                <span className={`mt-[5px] w-1.5 h-1.5 rounded-full shrink-0 ${band.bar}`} />
                <span className="text-sm text-slate-300 leading-snug">{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className={`rounded-xl border ${band.border} bg-slate-900/60 p-5 flex flex-col`}>
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.18em] mb-4 leading-tight">
            Стратегический вывод
          </p>
          <p className={`text-sm font-medium leading-snug ${band.textColor}`}>
            {conclusion}
          </p>
          <p className="mt-auto pt-4 text-xs text-slate-600 leading-relaxed">
            ASI показывает не только как усилить объект, но и где сама локация ограничивает результат.
          </p>
        </div>
      </div>

      <p className="mt-5 text-xs text-slate-600 text-center leading-relaxed">
        Статичные отчёты показывают срез. ASI показывает, что это значит для стратегии объекта.
      </p>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function LocationIntelligenceDemo() {
  const [selected, setSelected] = useState<SelectedAddress | null>(null);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'result'>('idle');
  const [step, setStep] = useState(0);
  const [score, setScore] = useState<number | null>(null);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [audienceScores, setAudienceScores] = useState<AudienceScore[]>([]);
  const [validationErr, setValidationErr] = useState(false);
  // Incrementing this key remounts AddressInput, resetting its internal state
  const [inputKey, setInputKey] = useState(0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) {
      setValidationErr(true);
      return;
    }
    setValidationErr(false);
    setPhase('loading');
    setStep(0);
  }

  function reset() {
    setSelected(null);
    setPhase('idle');
    setScore(null);
    setMetrics([]);
    setAudienceScores([]);
    setValidationErr(false);
    setInputKey(k => k + 1);
  }

  // Loading step ticker → score calculation
  useEffect(() => {
    if (phase !== 'loading' || !selected) return;
    const isLast = step >= LOADING_STEPS.length - 1;
    const t = setTimeout(() => {
      if (!isLast) {
        setStep(s => s + 1);
      } else {
        const h = simpleHash(selected.value.trim().toLowerCase());
        const s = scoreAddress(selected.value);
        const m = deriveMetrics(s, h);
        setScore(s);
        setMetrics(m);
        setAudienceScores(deriveAudienceScores(s, m, h));
        setPhase('result');
      }
    }, isLast ? 700 : 600);
    return () => clearTimeout(t);
  }, [phase, step, selected]);

  const band = score !== null ? getBand(score) : null;

  return (
    <section className="py-20 sm:py-24 px-4 sm:px-6 border-t border-slate-800/60 bg-slate-950">
      <div className="max-w-5xl mx-auto">

        {/* Section header with mascot */}
        <div className="flex items-start gap-5 mb-10">
          <AsiCat mode="location" size={72} className="shrink-0 mt-1" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 mb-1">
              Демо 1 из 2
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-white leading-tight">
              Система понимает потенциал вашего объекта
            </h2>
            <p className="mt-2 text-slate-400 max-w-lg">
              Введите адрес — и посмотрите, как ASI оценивает локацию: силу точки, окружение, спрос.
            </p>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-start">

          {/* ── left: form ── */}
          <div>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <AddressInput
                key={inputKey}
                onSelect={addr => { setSelected(addr); setValidationErr(false); }}
                onClear={() => { setSelected(null); }}
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
                {phase === 'loading' ? 'Идёт анализ...' : 'Рассчитать локацию'}
              </button>
            </form>

            {phase === 'result' && (
              <button
                onClick={reset}
                className="mt-4 w-full py-3 px-6 rounded-xl border border-slate-700/80 text-sm text-slate-400 hover:border-slate-600 hover:text-slate-200 hover:bg-slate-800/40 transition-all"
              >
                Проверить другой адрес
              </button>
            )}

            {phase === 'idle' && (
              <p className="mt-5 text-xs text-slate-600">
                Демо-режим — результаты носят иллюстративный характер
              </p>
            )}
          </div>

          {/* ── right: map / result ── */}
          <div>
            {phase === 'result' ? (
              band !== null && score !== null && (
                <ResultCard
                  address={selected?.value ?? ''}
                  score={score}
                  band={band}
                  metrics={metrics}
                  audienceScores={audienceScores}
                />
              )
            ) : selected ? (
              /* Real map panel — shown as soon as an address is selected.
                 Loading overlay appears on top during analysis. */
              <div className="relative">
                <RealMapPanel lat={selected.lat} lon={selected.lon} />
                {phase === 'loading' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-sm rounded-2xl">
                    <div className="w-7 h-7 border-2 border-slate-700 border-t-indigo-400 rounded-full animate-spin mb-5" />
                    <p className="text-white font-semibold text-base">{LOADING_STEPS[step]}</p>
                    <p className="mt-1.5 text-xs text-slate-500">по живым пространственным данным</p>
                    <div className="flex gap-2 mt-5">
                      {LOADING_STEPS.map((_, i) => (
                        <div
                          key={i}
                          className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${i <= step ? 'bg-indigo-400' : 'bg-slate-700'}`}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Decorative idle panel — shown before any address is selected */
              <IdleMapPanel />
            )}
          </div>

        </div>

        {phase === 'result' && score !== null && metrics.length > 0 && (
          <InsightPanel score={score} metrics={metrics} />
        )}

      </div>
    </section>
  );
}
