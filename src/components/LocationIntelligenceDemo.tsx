'use client';

import { useState, useEffect } from 'react';

// ── deterministic mock helpers ───────────────────────────────────────────────

/** Simple polynomial hash → positive 31-bit integer */
function simpleHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) & 0x7fffffff;
  }
  return h || 1;
}

/** Park-Miller LCG — safe integer arithmetic */
function lcg(n: number): number {
  return (n * 48271) % 2147483647;
}

function scoreAddress(address: string): number {
  return 42 + (simpleHash(address.trim().toLowerCase()) % 55);
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
    const delta = (s % 25) - 12; // -12..+12
    return { label, value: Math.max(22, Math.min(97, score + delta)) };
  });
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

// ── insight derivation ───────────────────────────────────────────────────────

interface Insights {
  reasons: string[];
  audiences: string[];
  actions: string[];
}

function deriveInsights(score: number, metrics: Metric[]): Insights {
  const transport  = metrics[0]?.value ?? score;
  const demand     = metrics[1]?.value ?? score;
  const competition = metrics[2]?.value ?? score;
  const audience   = metrics[3]?.value ?? score;
  const district   = metrics[4]?.value ?? score;

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

const LOADING_STEPS = [
  'Анализируем локацию...',
  'Собираем сигналы...',
  'Строим карту спроса...',
];

const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R; // ≈ 326.7

// ── map panel (idle / loading) ───────────────────────────────────────────────

const BLOBS = [
  { top: 28, left: 24, size: 130, op: 0.18 },
  { top: 52, left: 60, size: 160, op: 0.14 },
  { top: 18, left: 70, size: 90,  op: 0.22 },
  { top: 72, left: 38, size: 110, op: 0.11 },
  { top: 62, left: 78, size: 75,  op: 0.16 },
];

const SIGNAL_DOTS = [
  { top: 28, left: 24 },
  { top: 18, left: 70 },
  { top: 52, left: 60 },
];

function MapPanel({ loading, step }: { loading: boolean; step: number }) {
  return (
    <div
      className="relative w-full rounded-2xl border border-slate-800 overflow-hidden"
      style={{ height: 340 }}
    >
      {/* dot-grid background */}
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

      {/* heatmap blobs */}
      <div className={`absolute inset-0 ${loading ? 'animate-pulse' : ''}`}>
        {BLOBS.map((b, i) => (
          <div
            key={i}
            className="absolute rounded-full pointer-events-none"
            style={{
              top: `${b.top}%`, left: `${b.left}%`,
              width: b.size, height: b.size,
              background: 'radial-gradient(circle, rgba(99,102,241,1) 0%, transparent 70%)',
              opacity: loading ? b.op * 2.8 : b.op,
              filter: 'blur(22px)',
              transform: 'translate(-50%, -50%)',
              transition: 'opacity 0.5s ease',
            }}
          />
        ))}
      </div>

      {/* signal dots */}
      {SIGNAL_DOTS.map((d, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-indigo-400 animate-ping pointer-events-none"
          style={{
            top: `${d.top}%`, left: `${d.left}%`,
            width: 6, height: 6,
            transform: 'translate(-50%, -50%)',
            opacity: loading ? 0.9 : 0.35,
            animationDuration: `${1.4 + i * 0.35}s`,
          }}
        />
      ))}

      {/* loading overlay */}
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/60 rounded-2xl">
          <div className="w-7 h-7 border-2 border-slate-600 border-t-white rounded-full animate-spin mb-4" />
          <p className="text-white font-semibold text-base">{LOADING_STEPS[step]}</p>
          <p className="mt-1 text-xs text-slate-500">по живым пространственным данным</p>
        </div>
      )}

      {/* idle hint */}
      {!loading && (
        <div className="absolute inset-x-0 bottom-0 p-4 flex items-end justify-between">
          <p className="text-xs text-slate-700">Введите адрес для анализа</p>
          <p className="text-xs text-slate-800 font-mono">ASI · spatial engine</p>
        </div>
      )}
    </div>
  );
}

// ── result card ──────────────────────────────────────────────────────────────

function ResultCard({
  address, score, band, metrics,
}: {
  address: string;
  score: number;
  band: Band;
  metrics: Metric[];
}) {
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setAnimated(true), 80);
    return () => clearTimeout(t);
  }, []);

  const dashFill = animated ? (score / 100) * RING_C : 0;

  return (
    <div className={`rounded-2xl border ${band.border} ${band.bg} overflow-hidden`}>
      {/* score header */}
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
          <p className={`text-xl sm:text-2xl font-bold ${band.textColor}`}>
            {band.label}
          </p>
          <p className="mt-1.5 text-sm text-slate-400 leading-snug">{band.desc}</p>
          <p className="mt-2.5 text-xs text-slate-600 truncate">{address}</p>
        </div>
      </div>

      {/* metrics */}
      <div className="p-5 space-y-4">
        {metrics.map(m => (
          <div key={m.label}>
            <div className="flex justify-between mb-1.5">
              <span className="text-xs text-slate-400">{m.label}</span>
              <span className="text-xs font-semibold text-slate-300">{m.value}</span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-800/80">
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
    </div>
  );
}

// ── insight panel ────────────────────────────────────────────────────────────

function InsightPanel({ score, metrics }: { score: number; metrics: Metric[] }) {
  const { reasons, audiences, actions } = deriveInsights(score, metrics);

  const blocks = [
    {
      title: 'Почему система оценила локацию так',
      items: reasons,
      dot: 'bg-slate-400',
    },
    {
      title: 'Кому подходит эта локация',
      items: audiences,
      dot: 'bg-indigo-400',
    },
    {
      title: 'Что усилит результат',
      items: actions,
      dot: 'bg-emerald-400',
    },
  ];

  return (
    <div className="mt-12">
      <div className="grid sm:grid-cols-3 gap-5">
        {blocks.map(block => (
          <div
            key={block.title}
            className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"
          >
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-[0.18em] mb-4 leading-tight">
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
      <p className="mt-5 text-xs text-slate-600 text-center leading-relaxed">
        Статичные отчёты показывают срез. ASI показывает, что это значит для стратегии объекта.
      </p>
    </div>
  );
}

// ── main export ──────────────────────────────────────────────────────────────

export function LocationIntelligenceDemo() {
  const [address, setAddress] = useState('');
  const [phase, setPhase] = useState<'idle' | 'loading' | 'result'>('idle');
  const [step, setStep] = useState(0);
  const [score, setScore] = useState<number | null>(null);
  const [metrics, setMetrics] = useState<Metric[]>([]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!address.trim()) return;
    setPhase('loading');
    setStep(0);
  }

  function reset() {
    setPhase('idle');
    setScore(null);
    setMetrics([]);
    setAddress('');
  }

  useEffect(() => {
    if (phase !== 'loading') return;
    const isLast = step >= LOADING_STEPS.length - 1;
    const t = setTimeout(() => {
      if (!isLast) {
        setStep(s => s + 1);
      } else {
        const h = simpleHash(address.trim().toLowerCase());
        const s = scoreAddress(address);
        setScore(s);
        setMetrics(deriveMetrics(s, h));
        setPhase('result');
      }
    }, isLast ? 700 : 600);
    return () => clearTimeout(t);
  }, [phase, step, address]);

  const band = score !== null ? getBand(score) : null;

  return (
    <section className="py-28 sm:py-36 px-4 sm:px-6 border-t border-slate-800/60 bg-slate-950">
      <div className="max-w-5xl mx-auto">

        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500 mb-5">
          Локационная аналитика
        </p>

        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-start">

          {/* ── left: copy + form ── */}
          <div>
            <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight leading-tight">
              Проверьте потенциал локации вашего объекта
            </h2>
            <p className="mt-4 text-base font-medium text-slate-200 leading-snug">
              Не разовый PDF по адресу, а живая локационная аналитика для реальных решений.
            </p>
            <p className="mt-4 text-base text-slate-400 leading-relaxed">
              Введите адрес, и мы покажем, как система оценивает локацию в реальном
              времени: силу точки, окружение и потенциал спроса.
            </p>
            <p className="mt-2 text-sm text-slate-500">
              По живым пространственным сигналам — точнее, чем статичные отчёты.
            </p>

            <form onSubmit={handleSubmit} className="mt-10 flex flex-col gap-3">
              <input
                type="text"
                value={address}
                onChange={e => setAddress(e.target.value)}
                placeholder="Введите адрес объекта"
                disabled={phase === 'loading'}
                className="w-full px-5 py-4 rounded-xl bg-slate-800/80 border border-slate-700 text-white placeholder-slate-500 text-base focus:outline-none focus:ring-2 focus:ring-white/15 focus:border-slate-600 transition-all disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!address.trim() || phase === 'loading'}
                className="w-full py-4 px-8 bg-white text-slate-900 font-bold text-base rounded-xl hover:bg-slate-100 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-white/5 hover:shadow-white/10 hover:scale-[1.01] active:scale-[0.99]"
              >
                {phase === 'loading' ? 'Идёт анализ...' : 'Рассчитать локацию'}
              </button>
            </form>

            {phase === 'result' && (
              <button
                onClick={reset}
                className="mt-5 text-sm text-slate-500 hover:text-slate-300 transition-colors underline underline-offset-4"
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

          {/* ── right: visual / result ── */}
          <div>
            {phase !== 'result' ? (
              <MapPanel loading={phase === 'loading'} step={step} />
            ) : (
              band !== null && score !== null && (
                <ResultCard
                  address={address}
                  score={score}
                  band={band}
                  metrics={metrics}
                />
              )
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
