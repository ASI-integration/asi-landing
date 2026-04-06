'use client';

import { useLocationTelemetryOptional, type TelemetryLogEntry } from '@/context/landing-location-telemetry';

const BADGE_COLORS: Record<TelemetryLogEntry['kind'], string> = {
  ok: 'text-emerald-400/90',
  info: 'text-slate-400',
  warn: 'text-amber-400/90',
};

const IDLE_ENTRY: TelemetryLogEntry = {
  id: -1,
  timestamp: '',
  badge: '···',
  text: 'Analysis signals will appear here after running the demo location below.',
  kind: 'info',
};

export function HeroMonitor() {
  const tel = useLocationTelemetryOptional();
  const entries = tel?.entries ?? [];
  const snapshot = tel?.snapshot ?? {
    evergreenIndex: null,
    magnetCount: null,
    competitorCount: null,
    demandTypeLabel: null,
    dataStatusLabel: null,
  };

  const visibleLog = entries.length > 0 ? entries.slice(-4) : [IDLE_ENTRY];
  const hasLiveSignals = entries.length > 0;

  const indexLabel = snapshot.evergreenIndex != null ? String(snapshot.evergreenIndex) : '—';
  const magnetLabel = snapshot.magnetCount != null ? String(snapshot.magnetCount) : '—';
  const competitorLabel = snapshot.competitorCount != null ? String(snapshot.competitorCount) : '—';
  const demandLabel = snapshot.demandTypeLabel ?? '—';
  const statusLabel = snapshot.dataStatusLabel ?? (hasLiveSignals ? '—' : 'awaiting calculation');

  return (
    <div className="w-full rounded-2xl border border-slate-700/60 bg-slate-900/80 shadow-2xl shadow-black/60 overflow-hidden backdrop-blur-sm">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800/90 bg-slate-950/60">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-500/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
        <span className="ml-3 text-xs font-mono text-slate-500 truncate select-none">
          asi.location · analysis log
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {hasLiveSignals ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-sky-400/90" />
              <span className="text-xs font-mono text-slate-500">demo</span>
            </>
          ) : (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
              <span className="text-xs font-mono text-slate-600">idle</span>
            </>
          )}
        </span>
      </div>

      <div className="p-4 sm:p-5 grid grid-cols-5 gap-4" style={{ minHeight: 360 }}>

        <div
          className="col-span-3 rounded-xl border border-slate-800/60 bg-slate-950/50 px-4 py-4 flex flex-col overflow-hidden"
          style={{ minHeight: 300 }}
        >
          <p className="text-[11px] sm:text-xs font-mono uppercase tracking-[0.2em] text-slate-500 mb-3 shrink-0">
            location analysis signals
          </p>
          <div className="flex-1 flex flex-col justify-end gap-0 overflow-hidden min-h-0">
            {visibleLog.map((entry, i) => (
              <div
                key={entry.id}
                className="flex items-start gap-2 min-w-0 py-2 border-b border-slate-800/40 last:border-0"
                style={{ opacity: entries.length > 0 ? 0.45 + 0.18 * i : 0.85 }}
              >
                <span className="text-xs font-mono text-slate-500 shrink-0 tabular-nums w-[58px] pt-0.5">
                  {entry.timestamp || '·····'}
                </span>
                <span className={`text-xs font-mono font-bold shrink-0 w-9 pt-0.5 ${BADGE_COLORS[entry.kind]}`}>
                  {entry.badge}
                </span>
                <span className={`text-sm sm:text-[15px] font-mono leading-snug break-words ${BADGE_COLORS[entry.kind]}`}>
                  {entry.text}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="col-span-2 flex flex-col gap-2.5">

          <div className="rounded-xl border border-slate-800/70 bg-slate-950/50 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">Location Score</p>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-3xl font-bold text-white tabular-nums">{indexLabel}</span>
              <span className="text-xs text-slate-600">/ 100</span>
            </div>
            <div className="mt-2 h-1 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all duration-700"
                style={{
                  width: snapshot.evergreenIndex != null ? `${Math.min(100, Math.max(0, snapshot.evergreenIndex))}%` : '0%',
                }}
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-800/70 bg-slate-950/50 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">OSM Environment</p>
            <div className="flex gap-4 mt-1.5">
              <div>
                <p className="text-[10px] font-mono text-slate-600">magnets</p>
                <p className="text-xl font-bold text-indigo-400 tabular-nums">{magnetLabel}</p>
              </div>
              <div>
                <p className="text-[10px] font-mono text-slate-600">competitors</p>
                <p className="text-xl font-bold text-slate-300 tabular-nums">{competitorLabel}</p>
              </div>
            </div>
          </div>

          <div className="flex-1 rounded-xl border border-slate-800/70 bg-slate-950/50 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600 mb-2">Demand &amp; Data</p>
            <div className="space-y-1.5">
              <div className="flex items-start gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full shrink-0 mt-1 bg-sky-500/80" />
                <span className="text-[10px] font-mono text-slate-500 leading-snug">
                  Demand type: <span className="text-slate-400">{demandLabel}</span>
                </span>
              </div>
              <div className="flex items-start gap-1.5">
                <span
                  className={`h-1.5 w-1.5 rounded-full shrink-0 mt-1 ${
                    statusLabel.includes('current') || statusLabel.includes('fresh') ? 'bg-emerald-500' : statusLabel.includes('updat') || statusLabel.includes('stale') ? 'bg-amber-400' : 'bg-slate-500'
                  }`}
                />
                <span className="text-[10px] font-mono text-slate-500 leading-snug">
                  <span className="text-slate-400">{statusLabel}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
