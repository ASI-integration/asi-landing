'use client';

import { useState, useEffect, useRef } from 'react';

// 14 possible grid positions (x%, y%) for activity dots
const ALL_POSITIONS = [
  { x: 10, y: 14 }, { x: 28, y: 10 }, { x: 52, y: 13 }, { x: 74, y: 11 }, { x: 90, y: 18 },
  { x: 16, y: 38 }, { x: 40, y: 33 }, { x: 63, y: 40 }, { x: 85, y: 35 },
  { x: 8,  y: 62 }, { x: 34, y: 58 }, { x: 57, y: 65 }, { x: 78, y: 60 }, { x: 92, y: 55 },
  { x: 22, y: 82 }, { x: 48, y: 78 }, { x: 70, y: 84 },
];

const LOG_LINES = [
  '→ гость · Арбатская · ранний заезд',
  '✓ ответ отправлен · 0.4s',
  '→ код доступа · объект #2 · запрошен',
  '✓ инструкция отправлена',
  '→ доплата за поздний выезд',
  '⚡ счёт выставлен · 3 200 ₽',
  '→ клининг закрыт · Сокол',
  '✓ следующий заезд через 3ч',
  '→ продление · +2 дня · объект #4',
  '✓ доступность подтверждена',
  '→ отзыв получен · 5★ · Дуплекс',
  '→ запрос на парковку · выслан код',
  '✓ операций за сутки: 47',
  '→ уточнение аудитории · B2B',
];

function pickRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

export function HeroMonitor() {
  const [activeDots, setActiveDots] = useState<typeof ALL_POSITIONS>([]);
  const [logOffset, setLogOffset] = useState(0);
  const [score, setScore] = useState(87);
  const [ops, setOps] = useState(47);
  const frameRef = useRef(0);

  // Randomize active dots
  useEffect(() => {
    // Initial random selection
    setActiveDots(pickRandom(ALL_POSITIONS, 4));

    const dotInterval = setInterval(() => {
      const count = 3 + Math.floor(Math.random() * 3); // 3–5 dots
      setActiveDots(pickRandom(ALL_POSITIONS, count));
    }, 1400);

    return () => clearInterval(dotInterval);
  }, []);

  // Scroll log lines
  useEffect(() => {
    const logInterval = setInterval(() => {
      setLogOffset(o => (o + 1) % LOG_LINES.length);
    }, 1800);
    return () => clearInterval(logInterval);
  }, []);

  // Occasionally bump score/ops
  useEffect(() => {
    const ticker = setInterval(() => {
      frameRef.current += 1;
      if (frameRef.current % 7 === 0) setScore(s => Math.min(99, s + Math.floor(Math.random() * 2)));
      if (frameRef.current % 3 === 0) setOps(o => o + 1);
    }, 1200);
    return () => clearInterval(ticker);
  }, []);

  const visibleLogs = Array.from({ length: 5 }, (_, i) =>
    LOG_LINES[(logOffset + i) % LOG_LINES.length]
  );

  return (
    <div className="w-full rounded-2xl border border-slate-700/60 bg-slate-900/80 shadow-2xl shadow-black/60 overflow-hidden backdrop-blur-sm">
      {/* Window chrome */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-800/90 bg-slate-950/60">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-500/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
        <span className="ml-3 text-[10px] font-mono text-slate-600 truncate select-none">
          dashboard.asi.app · live
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[10px] font-mono text-emerald-600">активен</span>
        </span>
      </div>

      {/* Body */}
      <div className="p-3 sm:p-4 grid grid-cols-5 gap-3" style={{ minHeight: 300 }}>

        {/* Left: activity canvas */}
        <div className="col-span-3 relative rounded-xl border border-slate-800/60 bg-slate-950/50 overflow-hidden" style={{ minHeight: 260 }}>
          {/* grid lines */}
          <div
            className="absolute inset-0 pointer-events-none opacity-[0.04]"
            style={{
              backgroundImage:
                'linear-gradient(rgba(255,255,255,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.15) 1px, transparent 1px)',
              backgroundSize: '20px 20px',
            }}
          />

          {/* Activity dots — each in absolute position, transition opacity */}
          {ALL_POSITIONS.map((pos, i) => {
            const isActive = activeDots.some(d => d.x === pos.x && d.y === pos.y);
            return (
              <div
                key={i}
                className="absolute rounded-full pointer-events-none"
                style={{
                  left: `${pos.x}%`,
                  top: `${pos.y}%`,
                  width: isActive ? 7 : 4,
                  height: isActive ? 7 : 4,
                  transform: 'translate(-50%, -50%)',
                  background: isActive ? '#818cf8' : '#1e293b',
                  boxShadow: isActive ? '0 0 10px 3px rgba(99,102,241,0.4)' : 'none',
                  transition: 'all 0.6s ease',
                  opacity: isActive ? 1 : 0.4,
                }}
              />
            );
          })}

          {/* Connection lines between active dots (faux graph) */}
          {activeDots.length >= 2 && (
            <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden>
              {activeDots.slice(0, -1).map((d, i) => {
                const next = activeDots[i + 1];
                return (
                  <line
                    key={i}
                    x1={`${d.x}%`} y1={`${d.y}%`}
                    x2={`${next.x}%`} y2={`${next.y}%`}
                    stroke="rgba(99,102,241,0.15)"
                    strokeWidth="1"
                  />
                );
              })}
            </svg>
          )}

          {/* Bottom label */}
          <div className="absolute bottom-2 left-3">
            <span className="text-[9px] font-mono text-slate-700 uppercase tracking-widest">spatial · demand</span>
          </div>
        </div>

        {/* Right: stats + log */}
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

          {/* Log feed */}
          <div className="flex-1 rounded-xl border border-slate-800/70 bg-slate-950/50 px-3 py-2 overflow-hidden">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600 mb-1.5">Лог</p>
            <div className="space-y-1.5">
              {visibleLogs.map((line, i) => (
                <p
                  key={`${logOffset}-${i}`}
                  className="text-[10px] font-mono leading-tight truncate"
                  style={{
                    color: line.startsWith('✓') ? 'rgba(52,211,153,0.75)' :
                           line.startsWith('⚡') ? 'rgba(251,191,36,0.75)' :
                           'rgba(148,163,184,0.5)',
                    opacity: 1 - i * 0.15,
                  }}
                >
                  {line}
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
