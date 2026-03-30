'use client';

import { useState, useEffect, useRef } from 'react';

interface LogEntry {
  id: number;
  timestamp: string;
  badge: string;
  text: string;
  kind: 'ok' | 'event' | 'warn' | 'pay';
}

const EVENT_POOL: Array<{ badge: string; text: string; kind: LogEntry['kind'] }> = [
  { badge: 'MSG',  text: 'гость · Арбатская · время заезда запрошено',   kind: 'event' },
  { badge: '✓',   text: 'ответ отправлен · 0.4s',                         kind: 'ok'    },
  { badge: 'MSG',  text: 'код доступа · объект #2 · запрошен',            kind: 'event' },
  { badge: '✓',   text: 'инструкция отправлена гостю',                    kind: 'ok'    },
  { badge: 'PAY',  text: 'доплата · поздний выезд · выставлен счёт',     kind: 'pay'   },
  { badge: '✓',   text: '3 200 ₽ · платёж принят',                       kind: 'ok'    },
  { badge: 'CLN',  text: 'клининг закрыт · Сокол · статус OK',           kind: 'event' },
  { badge: '✓',   text: 'следующий заезд через 3ч · подтверждено',       kind: 'ok'    },
  { badge: 'MSG',  text: 'продление +2 дня · объект #4 · запрос',        kind: 'event' },
  { badge: '✓',   text: 'доступность подтверждена · бронь обновлена',    kind: 'ok'    },
  { badge: 'MSG',  text: 'запрос парковки · Коломенская',                 kind: 'event' },
  { badge: '✓',   text: 'код двора выслан · 0.3s',                       kind: 'ok'    },
  { badge: '⚠',   text: 'шум · объект #7 · оператор подключён',          kind: 'warn'  },
  { badge: 'SCH',  text: 'расписание клининга обновлено автоматически',   kind: 'event' },
  { badge: 'MSG',  text: 'гость · Речной вокзал · нет Wi-Fi',            kind: 'event' },
  { badge: '✓',   text: 'инструкция отправлена · 0.5s',                  kind: 'ok'    },
  { badge: 'PAY',  text: 'залог за животное · 2 000 ₽ · счёт создан',   kind: 'pay'   },
  { badge: '✓',   text: 'счёт отправлен гостю',                          kind: 'ok'    },
  { badge: 'MSG',  text: 'ранний заезд · согласован · объект #3',        kind: 'event' },
  { badge: '✓',   text: 'расписание клининга скорректировано',           kind: 'ok'    },
  { badge: 'MSG',  text: 'гость запрашивает скидку · история проверена', kind: 'event' },
  { badge: '✓',   text: 'промокод LOYALTY10 выслан',                     kind: 'ok'    },
];

function makeTimestamp(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

const BADGE_COLORS: Record<LogEntry['kind'], string> = {
  ok:    'text-emerald-400/90',
  event: 'text-slate-400',
  warn:  'text-amber-400/90',
  pay:   'text-amber-300/90',
};

export function HeroMonitor() {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [score, setScore] = useState(87);
  const [ops, setOps] = useState(47);
  const poolIdx = useRef(0);
  const entryId = useRef(0);
  const frameRef = useRef(0);

  // Pre-populate log
  useEffect(() => {
    const now = Date.now();
    const initial: LogEntry[] = [];
    for (let i = 7; i >= 0; i--) {
      const ev = EVENT_POOL[poolIdx.current % EVENT_POOL.length];
      poolIdx.current++;
      initial.push({ id: entryId.current++, timestamp: makeTimestamp(now - i * 2100), ...ev });
    }
    setLog(initial);
  }, []);

  // Stream new events
  useEffect(() => {
    const interval = setInterval(() => {
      const ev = EVENT_POOL[poolIdx.current % EVENT_POOL.length];
      poolIdx.current++;
      setLog(prev => [...prev.slice(-14), {
        id: entryId.current++,
        timestamp: makeTimestamp(Date.now()),
        ...ev,
      }]);
    }, 1700);
    return () => clearInterval(interval);
  }, []);

  // Bump counters
  useEffect(() => {
    const ticker = setInterval(() => {
      frameRef.current += 1;
      if (frameRef.current % 7 === 0) setScore(s => Math.min(99, s + Math.floor(Math.random() * 2)));
      if (frameRef.current % 3 === 0) setOps(o => o + 1);
    }, 1200);
    return () => clearInterval(ticker);
  }, []);

  const visibleLog = log.slice(-7);

  return (
    <div className="w-full rounded-2xl border border-slate-700/60 bg-slate-900/80 shadow-2xl shadow-black/60 overflow-hidden backdrop-blur-sm">
      {/* Window chrome */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-800/90 bg-slate-950/60">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-500/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
        <span className="ml-3 text-[10px] font-mono text-slate-600 truncate select-none">
          asi.system · activity log
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[10px] font-mono text-emerald-600">live</span>
        </span>
      </div>

      {/* Body */}
      <div className="p-3 sm:p-4 grid grid-cols-5 gap-3" style={{ minHeight: 300 }}>

        {/* Left: live log feed */}
        <div
          className="col-span-3 rounded-xl border border-slate-800/60 bg-slate-950/50 px-3 py-2.5 flex flex-col overflow-hidden"
          style={{ minHeight: 260 }}
        >
          <p className="text-[9px] font-mono uppercase tracking-widest text-slate-700 mb-2 shrink-0">
            системный журнал · все объекты
          </p>
          <div className="flex-1 space-y-1.5 overflow-hidden">
            {visibleLog.map((entry, i) => (
              <div
                key={entry.id}
                className="flex items-baseline gap-1.5 min-w-0"
                style={{ opacity: 0.35 + 0.095 * i }}
              >
                <span className="text-[9px] font-mono text-slate-700 shrink-0 tabular-nums w-[52px]">
                  {entry.timestamp}
                </span>
                <span className={`text-[9px] font-mono font-bold shrink-0 w-7 ${BADGE_COLORS[entry.kind]}`}>
                  {entry.badge}
                </span>
                <span className={`text-[10px] font-mono leading-tight truncate ${BADGE_COLORS[entry.kind]}`}>
                  {entry.text}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: stats */}
        <div className="col-span-2 flex flex-col gap-2.5">

          {/* Score card */}
          <div className="rounded-xl border border-slate-800/70 bg-slate-950/50 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">Индекс объекта</p>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-3xl font-bold text-white tabular-nums">{score}</span>
              <span className="text-xs text-slate-600">/ 100</span>
            </div>
            <div className="mt-2 h-1 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-700"
                style={{ width: `${score}%` }}
              />
            </div>
          </div>

          {/* Ops counter */}
          <div className="rounded-xl border border-slate-800/70 bg-slate-950/50 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">Операций сегодня</p>
            <p className="text-2xl font-bold text-indigo-400 tabular-nums mt-0.5">{ops}</p>
          </div>

          {/* System status */}
          <div className="flex-1 rounded-xl border border-slate-800/70 bg-slate-950/50 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600 mb-2">Статус</p>
            <div className="space-y-1.5">
              {[
                { label: 'ИИ-ядро',       ok: true },
                { label: 'Каналы связи',  ok: true },
                { label: 'Интеграции',    ok: true },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${item.ok ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                  <span className="text-[10px] font-mono text-slate-500 truncate">{item.label}</span>
                  <span className={`ml-auto text-[9px] font-mono shrink-0 ${item.ok ? 'text-emerald-600' : 'text-amber-500'}`}>
                    {item.ok ? 'OK' : 'warn'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
